import type { Operation, Patch } from '@lacuno/document'

export type Actor = { kind: 'editor' } | { kind: 'agent'; app: string }

/** One committed batch on a site, as the editor's event stream and activity list see it. */
export type SiteEvent = {
  revision: number
  patches: Patch[]
  actor: Actor
  at: number
  summary: string
}

type Listener = (event: SiteEvent) => void

const listeners = new Map<string, Set<Listener>>()
const recent = new Map<string, SiteEvent[]>()
const KEEP = 50

/** In-process fan-out of committed batches per site, with the last few kept for late joiners. */
export const siteEvents = {
  emit(siteId: string, event: SiteEvent) {
    const kept = recent.get(siteId) ?? []
    kept.push(event)
    if (kept.length > KEEP) kept.shift()
    recent.set(siteId, kept)
    for (const listener of listeners.get(siteId) ?? []) listener(event)
  },
  subscribe(siteId: string, listener: Listener): () => void {
    const set = listeners.get(siteId) ?? new Set()
    set.add(listener)
    listeners.set(siteId, set)
    return () => {
      set.delete(listener)
    }
  },
  recent(siteId: string): SiteEvent[] {
    return recent.get(siteId) ?? []
  },
}

/** "12 operations: node.create ×5, style.set ×7", or "3 changes" for a patch-only batch. */
export function summarize(operations: Operation[] | undefined, patches: Patch[]): string {
  if (!operations) return `${patches.length} ${patches.length === 1 ? 'change' : 'changes'}`
  const counts = new Map<string, number>()
  for (const op of operations) counts.set(op.type, (counts.get(op.type) ?? 0) + 1)
  const parts = [...counts].map(([type, n]) => (n > 1 ? `${type} ×${n}` : type))
  return `${operations.length} ${operations.length === 1 ? 'operation' : 'operations'}: ${parts.join(', ')}`
}
