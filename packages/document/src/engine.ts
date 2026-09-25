import type { Document } from '@lacuno/schema'
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
      const issue = parsed.error.issues[0]
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
