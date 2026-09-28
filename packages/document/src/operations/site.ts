import type { Mode } from '@lacuno/schema'
import { AssetId, Font, ModeId, Redirect, TitleTemplate } from '@lacuno/schema'
import { z } from 'zod'
import type { PlanContext } from '../context.js'
import { defineOperation } from '../define.js'
import { partialPatches } from '../partial.js'
import type { Patch } from '../patch.js'
import { designTokensUsingMode } from '../references.js'

const siteUpdate = defineOperation(
  z.strictObject({
    type: z.literal('site.update'),
    name: z.string().min(1).optional(),
    locale: z.string().min(1).optional(),
    url: z.url().nullable().optional(),
    titleTemplate: TitleTemplate.nullable().optional(),
    fonts: z.array(Font).optional(),
    favicon: AssetId.nullable().optional(),
    headCode: z.string().nullable().optional(),
    bodyCode: z.string().nullable().optional(),
  }),
  (op, ctx) => {
    if (op.favicon)
      ctx.require(ctx.doc.assets[op.favicon], `unknown asset ${op.favicon}`, op.favicon)
    for (const f of op.fonts ?? [])
      if (f.source === 'asset')
        ctx.require(
          f.asset ? ctx.doc.assets[f.asset] : undefined,
          `unknown asset ${f.asset}`,
          f.asset,
        )
    const { type: _type, ...values } = op
    return partialPatches(['site'], values, ctx.doc.site)
  },
)

const modeFields = {
  label: z.string().min(1),
  selector: z.string().min(1),
  media: z.string().min(1),
}

const modeIndex = (ctx: PlanContext, id: string): number =>
  ctx.indexOf(ctx.doc.site.modes, (m) => m.id === id, `unknown mode ${id}`, id)

function clearDefaultPatches(ctx: PlanContext, except: string): Patch[] {
  return ctx.doc.site.modes.flatMap((m, i) =>
    m.default && m.id !== except
      ? [{ op: 'delete' as const, path: ['site', 'modes', i, 'default'] }]
      : [],
  )
}

const modeCreate = defineOperation(
  z.strictObject({
    type: z.literal('mode.create'),
    id: ModeId.optional(),
    label: modeFields.label,
    default: z.boolean().optional(),
    selector: modeFields.selector.optional(),
    media: modeFields.media.optional(),
  }),
  (op, ctx) => {
    const id = ctx.id('mode', op.id)
    const mode: Record<string, unknown> = { id, label: op.label }
    if (op.default) mode.default = true
    if (op.selector !== undefined) mode.selector = op.selector
    if (op.media !== undefined) mode.media = op.media
    return [
      ...(op.default ? clearDefaultPatches(ctx, id) : []),
      { op: 'insert', path: ['site', 'modes'], index: ctx.doc.site.modes.length, value: mode },
    ]
  },
)

const modeUpdate = defineOperation(
  z.strictObject({
    type: z.literal('mode.update'),
    id: ModeId,
    label: modeFields.label.optional(),
    default: z.boolean().optional(),
    selector: modeFields.selector.nullable().optional(),
    media: modeFields.media.nullable().optional(),
  }),
  (op, ctx) => {
    const index = modeIndex(ctx, op.id)
    const mode = ctx.doc.site.modes[index] as Mode
    const patches: Patch[] = []
    if (op.default === true) {
      patches.push(...clearDefaultPatches(ctx, op.id))
      patches.push({ op: 'set', path: ['site', 'modes', index, 'default'], value: true })
    } else if (op.default === false) {
      if (mode.default)
        ctx.fail('cannot unset the default mode; make another mode the default first', {
          id: op.id,
        })
    }
    patches.push(
      ...partialPatches(
        ['site', 'modes', index],
        { label: op.label, selector: op.selector, media: op.media },
        mode,
      ),
    )
    return patches
  },
)

const modeDelete = defineOperation(
  z.strictObject({ type: z.literal('mode.delete'), id: ModeId }),
  (op, ctx) => {
    const index = modeIndex(ctx, op.id)
    const mode = ctx.doc.site.modes[index]
    if (mode?.default) ctx.fail('cannot delete the default mode', { id: op.id })
    if (ctx.doc.site.modes.length === 1) ctx.fail('cannot delete the last mode', { id: op.id })
    const users = designTokensUsingMode(ctx.doc, op.id)
    if (users.length)
      ctx.fail(`mode ${op.id} is referenced by design tokens`, { id: op.id, referencedBy: users })
    return [{ op: 'remove', path: ['site', 'modes'], index }]
  },
)

const redirectAdd = defineOperation(
  z.strictObject({
    type: z.literal('redirect.add'),
    from: z.string().min(1),
    to: z.string().min(1),
    status: Redirect.shape.status.optional(),
  }),
  (op, ctx) => {
    if (ctx.doc.redirects.some((r) => r.from === op.from))
      ctx.fail(`a redirect from ${op.from} already exists`)
    const value = { from: op.from, to: op.to, status: op.status ?? 301 }
    return [{ op: 'insert', path: ['redirects'], index: ctx.doc.redirects.length, value }]
  },
)

const redirectRemove = defineOperation(
  z.strictObject({ type: z.literal('redirect.remove'), from: z.string().min(1) }),
  (op, ctx) => {
    const index = ctx.indexOf(
      ctx.doc.redirects,
      (r) => r.from === op.from,
      `no redirect from ${op.from}`,
    )
    return [{ op: 'remove', path: ['redirects'], index }]
  },
)

export const siteOperations = [
  siteUpdate,
  modeCreate,
  modeUpdate,
  modeDelete,
  redirectAdd,
  redirectRemove,
]
