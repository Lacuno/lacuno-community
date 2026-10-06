import type { CssValue } from '@lacuno/schema'
import {
  BASE_BREAKPOINT_ID,
  BreakpointId,
  ClassId,
  CssValue as CssValueSchema,
  RichTag,
  State,
  StyleDecl,
  styleKey,
} from '@lacuno/schema'
import { z } from 'zod'
import type { PlanContext } from '../context.js'
import { defineOperation } from '../define.js'
import { partialPatches } from '../partial.js'
import type { Patch } from '../patch.js'
import { cssValueReferences, nodesUsingClass, stylesUsingBreakpoint } from '../references.js'

/** Every design token and asset a value references must exist; a token may not reference itself. */
export function checkCssValue(ctx: PlanContext, value: CssValue, selfTokenId?: string): void {
  const refs = { designTokens: new Set<string>(), assets: new Set<string>() }
  cssValueReferences(value, refs)
  for (const id of refs.designTokens) {
    if (id === selfTokenId) ctx.fail(`design token ${id} cannot reference itself`, { id })
    ctx.require(ctx.doc.designTokens[id], `unknown design token ${id}`, id)
  }
  for (const id of refs.assets) ctx.require(ctx.doc.assets[id], `unknown asset ${id}`, id)
}

function checkCombo(ctx: PlanContext, combo: readonly string[], self?: string): void {
  for (const parent of combo) {
    if (parent === self) ctx.fail(`class ${self} cannot be its own combo parent`, { id: self })
    ctx.require(ctx.doc.classes[parent], `unknown class ${parent}`, parent)
  }
}

const classCreate = defineOperation(
  z.strictObject({
    type: z.literal('class.create'),
    id: ClassId.optional(),
    name: z.string().min(1).optional(),
    /** A local class is an unnamed per-node style source. */
    local: z.boolean().optional(),
    preset: z.boolean().optional(),
    combo: z.array(ClassId).optional(),
    locked: z.boolean().optional(),
  }),
  (op, ctx) => {
    if (op.preset && (op.local || op.combo?.length))
      ctx.fail('presets must be standalone named classes')
    if (!op.local && op.name === undefined) ctx.fail('a named class needs a name')
    if (op.name !== undefined)
      ctx.unique(Object.values(ctx.doc.classes), 'class name', op.name, (c) => c.name)
    checkCombo(ctx, op.combo ?? [])
    const id = ctx.id('class', op.id)
    const cls = {
      id,
      kind: op.local ? 'local' : 'class',
      ...(op.name !== undefined ? { name: op.name } : {}),
      ...(op.combo?.length ? { combo: op.combo } : {}),
      ...(op.locked ? { locked: true } : {}),
      ...(op.preset ? { preset: true } : {}),
    }
    return [{ op: 'set', path: ['classes', id], value: cls }]
  },
)

const classUpdate = defineOperation(
  z.strictObject({
    type: z.literal('class.update'),
    id: ClassId,
    name: z.string().min(1).optional(),
    combo: z.array(ClassId).nullable().optional(),
    locked: z.boolean().nullable().optional(),
  }),
  (op, ctx) => {
    const cls = ctx.require(ctx.doc.classes[op.id], `unknown class ${op.id}`, op.id)
    if (op.name !== undefined)
      ctx.unique(Object.values(ctx.doc.classes), 'class name', op.name, (c) => c.name, op.id)
    if (op.combo) checkCombo(ctx, op.combo, op.id)
    return partialPatches(
      ['classes', op.id],
      { name: op.name, combo: op.combo, locked: op.locked },
      cls,
    )
  },
)

const classDelete = defineOperation(
  z.strictObject({ type: z.literal('class.delete'), id: ClassId }),
  (op, ctx) => {
    ctx.require(ctx.doc.classes[op.id], `unknown class ${op.id}`, op.id)
    const referencedBy = [
      ...Object.values(ctx.doc.classes)
        .filter((c) => c.combo?.includes(op.id))
        .map((c) => `classes.${c.id}`),
      ...nodesUsingClass(ctx.doc, op.id).map((n) => `nodes.${n}`),
    ].sort()
    if (referencedBy.length) ctx.fail(`class ${op.id} is referenced`, { id: op.id, referencedBy })
    const own = Object.entries(ctx.doc.styles)
      .filter(([, d]) => d.class === op.id)
      .map(([key]): Patch => ({ op: 'delete', path: ['styles', key] }))
    return [...own, { op: 'delete', path: ['classes', op.id] }]
  },
)

// A plain style is the base breakpoint without a state, so neither has to be written out.
const coordinates = {
  class: ClassId,
  tag: RichTag.optional(),
  breakpoint: BreakpointId.default(BASE_BREAKPOINT_ID),
  state: State.default('none'),
  property: StyleDecl.shape.property,
}

function checkCoordinates(ctx: PlanContext, op: { class: string; breakpoint: string }): void {
  ctx.require(ctx.doc.classes[op.class], `unknown class ${op.class}`, op.class)
  ctx.require(
    ctx.doc.breakpoints[op.breakpoint],
    `unknown breakpoint ${op.breakpoint}`,
    op.breakpoint,
  )
}

const styleSet = defineOperation(
  z.strictObject({
    type: z.literal('style.set'),
    ...coordinates,
    value: CssValueSchema,
    important: z.boolean().optional(),
  }),
  (op, ctx) => {
    checkCoordinates(ctx, op)
    checkCssValue(ctx, op.value)
    const { type: _type, important, tag, ...coords } = op
    const decl = { ...coords, ...(tag ? { tag } : {}), ...(important ? { important: true } : {}) }
    return [{ op: 'set', path: ['styles', styleKey(decl)], value: decl }]
  },
)

const styleClear = defineOperation(
  z.strictObject({ type: z.literal('style.clear'), ...coordinates }),
  (op, ctx) => {
    const key = styleKey(op)
    if (!ctx.doc.styles[key]) ctx.fail(`no declaration at ${key}`)
    return [{ op: 'delete', path: ['styles', key] }]
  },
)

const width = z.number().int().positive()

const breakpointCreate = defineOperation(
  z.strictObject({
    type: z.literal('breakpoint.create'),
    id: BreakpointId.optional(),
    label: z.string().min(1),
    maxWidth: width.optional(),
    minWidth: width.optional(),
  }),
  (op, ctx) => {
    const id = ctx.id('breakpoint', op.id)
    const bp = {
      id,
      label: op.label,
      ...(op.maxWidth !== undefined ? { maxWidth: op.maxWidth } : {}),
      ...(op.minWidth !== undefined ? { minWidth: op.minWidth } : {}),
    }
    return [{ op: 'set', path: ['breakpoints', id], value: bp }]
  },
)

const breakpointUpdate = defineOperation(
  z.strictObject({
    type: z.literal('breakpoint.update'),
    id: BreakpointId,
    label: z.string().min(1).optional(),
    maxWidth: width.nullable().optional(),
    minWidth: width.nullable().optional(),
  }),
  (op, ctx) => {
    const bp = ctx.require(ctx.doc.breakpoints[op.id], `unknown breakpoint ${op.id}`, op.id)
    if (op.id === BASE_BREAKPOINT_ID && (op.maxWidth || op.minWidth))
      ctx.fail('the base breakpoint has no width', { id: op.id })
    return partialPatches(
      ['breakpoints', op.id],
      { label: op.label, maxWidth: op.maxWidth, minWidth: op.minWidth },
      bp,
    )
  },
)

const breakpointDelete = defineOperation(
  z.strictObject({ type: z.literal('breakpoint.delete'), id: BreakpointId }),
  (op, ctx) => {
    ctx.require(ctx.doc.breakpoints[op.id], `unknown breakpoint ${op.id}`, op.id)
    if (op.id === BASE_BREAKPOINT_ID) ctx.fail('cannot delete the base breakpoint', { id: op.id })
    const referencedBy = stylesUsingBreakpoint(ctx.doc, op.id).map((k) => `styles.${k}`)
    if (referencedBy.length)
      ctx.fail(`breakpoint ${op.id} is referenced`, { id: op.id, referencedBy })
    return [{ op: 'delete', path: ['breakpoints', op.id] }]
  },
)

export const styleOperations = [
  classCreate,
  classUpdate,
  classDelete,
  styleSet,
  styleClear,
  breakpointCreate,
  breakpointUpdate,
  breakpointDelete,
]
