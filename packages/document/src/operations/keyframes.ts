import { type KeyframeStop, Keyframes, KeyframesId } from '@lacuno/schema'
import { z } from 'zod'
import type { PlanContext } from '../context.js'
import { defineOperation } from '../define.js'
import { referencesToKeyframes } from '../references.js'
import { checkCssValue } from './styles.js'

/** The stops sorted by `at`, refusing an `at` twice and values that reference what is missing. */
function sortedStops(ctx: PlanContext, stops: KeyframeStop[]): KeyframeStop[] {
  const sorted = [...stops].sort((a, b) => a.at - b.at)
  sorted.forEach((stop, i) => {
    if (stop.at === sorted[i - 1]?.at) ctx.fail(`two stops at ${stop.at}%`)
    for (const value of Object.values(stop.styles)) checkCssValue(ctx, value)
  })
  return sorted
}

const keyframesCreate = defineOperation(
  z.strictObject({
    type: z.literal('keyframes.create'),
    id: KeyframesId,
    stops: Keyframes.shape.stops,
  }),
  (op, ctx) => {
    if (ctx.doc.keyframes[op.id]) ctx.fail(`keyframes ${op.id} already exists`, { id: op.id })
    const value = { id: op.id, stops: sortedStops(ctx, op.stops) }
    return [{ op: 'set', path: ['keyframes', op.id], value }]
  },
)

const keyframesUpdate = defineOperation(
  z.strictObject({
    type: z.literal('keyframes.update'),
    id: KeyframesId,
    stops: Keyframes.shape.stops,
  }),
  (op, ctx) => {
    ctx.require(ctx.doc.keyframes[op.id], `unknown keyframes ${op.id}`, op.id)
    return [{ op: 'set', path: ['keyframes', op.id, 'stops'], value: sortedStops(ctx, op.stops) }]
  },
)

const keyframesDelete = defineOperation(
  z.strictObject({ type: z.literal('keyframes.delete'), id: KeyframesId }),
  (op, ctx) => {
    ctx.require(ctx.doc.keyframes[op.id], `unknown keyframes ${op.id}`, op.id)
    const referencedBy = referencesToKeyframes(ctx.doc, op.id)
    if (referencedBy.length)
      ctx.fail(`keyframes ${op.id} is referenced`, { id: op.id, referencedBy })
    return [{ op: 'delete', path: ['keyframes', op.id] }]
  },
)

export const keyframesOperations = [keyframesCreate, keyframesUpdate, keyframesDelete]
