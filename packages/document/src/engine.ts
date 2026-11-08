import type { Document } from '@lacuno/schema'
import type { z } from 'zod'
import { createContext, type Warning } from './context.js'
import type { OperationDef } from './define.js'
import { OperationError } from './errors.js'
import { deepFreeze, frozenCopy } from './freeze.js'
import { allIds } from './ids.js'
import { applyPatches, type Patch } from './patch.js'

export type PlanResult = {
  document: Document
  patches: Patch[]
  created: Record<number, string[]>
  warnings: Warning[]
}

/**
 * Plans and applies a batch against a draft, one operation at a time, so every operation sees
 * the effect of the ones before it. Throws OperationError on the first failure; nothing is
 * returned in that case, so callers keep their previous document.
 */
export function planBatch(
  doc: Document,
  operations: readonly ({ type: string } & Record<string, unknown>)[],
  defs: ReadonlyMap<string, OperationDef>,
): PlanResult {
  const ids = allIds(doc)
  const patches: Patch[] = []
  const created: Record<number, string[]> = {}
  const warnings: Warning[] = []
  let draft = frozenCopy(doc)
  operations.forEach((raw, index) => {
    const def = defs.get(raw.type)
    if (!def)
      throw new OperationError(index, String(raw.type), `unknown operation ${String(raw.type)}`)
    const parsed = def.schema.safeParse(raw)
    if (!parsed.success) {
      const issue = closest(parsed.error.issues[0])
      const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
      throw new OperationError(
        index,
        def.type,
        `invalid input: ${where}${issue?.message ?? 'invalid'}`,
      )
    }
    const mine: string[] = []
    const ctx = createContext({ doc: draft, index, type: def.type, ids, created: mine, warnings })
    const ownPatches = def.plan(parsed.data, ctx)
    draft = deepFreeze(applyPatches(draft, ownPatches))
    patches.push(...ownPatches)
    if (mine.length) created[index] = mine
  })
  return { document: draft, patches, created, warnings }
}

/**
 * The issue worth reporting: inside a union of shapes, that of the shape that came closest, the
 * one with the fewest issues, then the one that got deepest, so a bad unit reads "value.unit:
 * Invalid option: expected one of px|rem…" and not "value: Invalid input".
 */
function closest(issue: z.core.$ZodIssue | undefined): z.core.$ZodIssue | undefined {
  if (issue?.code !== 'invalid_union' || !issue.errors.length) return issue
  const depth = (issues: z.core.$ZodIssue[]) => issues[0]?.path.length ?? 0
  const best = issue.errors.reduce((a, b) =>
    b.length < a.length || (b.length === a.length && depth(b) > depth(a)) ? b : a,
  )
  const inner = closest(best[0])
  return inner ? { ...inner, path: [...issue.path, ...inner.path] } : issue
}
