import { CssValue, DesignToken, DesignTokenGroup, DesignTokenId, ModeId } from '@freeflow/schema'
import { z } from 'zod'
import type { PlanContext } from '../context.js'
import { defineOperation } from '../define.js'
import { partialPatches } from '../partial.js'
import { referencesToDesignToken } from '../references.js'
import { checkCssValue } from './styles.js'

function defaultMode(ctx: PlanContext): string {
  const def = ctx.doc.site.modes.find((m) => m.default) ?? ctx.doc.site.modes[0]
  return def?.id ?? 'light'
}

function checkMode(ctx: PlanContext, mode: string): void {
  if (!ctx.doc.site.modes.some((m) => m.id === mode)) ctx.fail(`unknown mode ${mode}`, { id: mode })
}

const tokenCreate = defineOperation(
  z.strictObject({
    type: z.literal('designToken.create'),
    id: DesignTokenId.optional(),
    name: DesignToken.shape.name,
    group: DesignTokenGroup,
    values: z.record(ModeId, CssValue),
    description: z.string().optional(),
  }),
  (op, ctx) => {
    ctx.unique(Object.values(ctx.doc.designTokens), 'design token name', op.name, (t) => t.name)
    // The value check runs before the id is minted, so a value referencing the id being created
    // reads as an unknown token rather than a self-reference.
    for (const [mode, value] of Object.entries(op.values)) {
      checkMode(ctx, mode)
      checkCssValue(ctx, value)
    }
    const def = defaultMode(ctx)
    if (op.values[def] === undefined) ctx.fail(`a value for the default mode ${def} is required`)
    const id = ctx.id('designToken', op.id)
    const token = {
      id,
      name: op.name,
      group: op.group,
      values: op.values,
      ...(op.description !== undefined ? { description: op.description } : {}),
    }
    return [{ op: 'set', path: ['designTokens', id], value: token }]
  },
)

const tokenUpdate = defineOperation(
  z.strictObject({
    type: z.literal('designToken.update'),
    id: DesignTokenId,
    name: DesignToken.shape.name.optional(),
    group: DesignTokenGroup.optional(),
    description: z.string().nullable().optional(),
  }),
  (op, ctx) => {
    const token = ctx.require(ctx.doc.designTokens[op.id], `unknown design token ${op.id}`, op.id)
    if (op.name !== undefined)
      ctx.unique(
        Object.values(ctx.doc.designTokens),
        'design token name',
        op.name,
        (t) => t.name,
        op.id,
      )
    return partialPatches(
      ['designTokens', op.id],
      { name: op.name, group: op.group, description: op.description },
      token,
    )
  },
)

const tokenSetValue = defineOperation(
  z.strictObject({
    type: z.literal('designToken.setValue'),
    id: DesignTokenId,
    mode: ModeId,
    value: CssValue,
  }),
  (op, ctx) => {
    ctx.require(ctx.doc.designTokens[op.id], `unknown design token ${op.id}`, op.id)
    checkMode(ctx, op.mode)
    checkCssValue(ctx, op.value, op.id)
    return [{ op: 'set', path: ['designTokens', op.id, 'values', op.mode], value: op.value }]
  },
)

const tokenClearValue = defineOperation(
  z.strictObject({ type: z.literal('designToken.clearValue'), id: DesignTokenId, mode: ModeId }),
  (op, ctx) => {
    const token = ctx.require(ctx.doc.designTokens[op.id], `unknown design token ${op.id}`, op.id)
    if (op.mode === defaultMode(ctx))
      ctx.fail(`cannot clear the default mode ${op.mode}; set another value instead`, { id: op.id })
    if (token.values[op.mode] === undefined)
      ctx.fail(`design token ${op.id} has no value for mode ${op.mode}`, { id: op.id })
    return [{ op: 'delete', path: ['designTokens', op.id, 'values', op.mode] }]
  },
)

const tokenDelete = defineOperation(
  z.strictObject({ type: z.literal('designToken.delete'), id: DesignTokenId }),
  (op, ctx) => {
    ctx.require(ctx.doc.designTokens[op.id], `unknown design token ${op.id}`, op.id)
    const referencedBy = referencesToDesignToken(ctx.doc, op.id)
    if (referencedBy.length)
      ctx.fail(`design token ${op.id} is referenced`, { id: op.id, referencedBy })
    return [{ op: 'delete', path: ['designTokens', op.id] }]
  },
)

export const designTokenOperations = [
  tokenCreate,
  tokenUpdate,
  tokenSetValue,
  tokenClearValue,
  tokenDelete,
]
