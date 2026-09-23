import type { Patch } from '@freeflow/document/patch'

/** One committed batch on the site, as the server's event stream sends it. */
export type SiteEvent = {
  revision: number
  patches: Patch[]
  actor: { kind: 'editor' } | { kind: 'agent'; app: string }
  at: number
  summary: string
}

/**
 * The queued events that continue `revision` without a hole, in order. Events the snapshot
 * already covers are dropped; `gap` is true when one is missing, so only a full read can catch up.
 */
export function catchUp(queue: SiteEvent[], revision: number) {
  const run: SiteEvent[] = []
  for (const event of queue) {
    const next = revision + run.length + 1
    if (event.revision < next) continue
    if (event.revision > next) return { run, gap: true }
    run.push(event)
  }
  return { run, gap: false }
}

/** The nodes a batch touches, named by its patch paths (`nodes.<id>…`), first touched first. */
export const touchedNodes = (patches: Patch[]) => [
  ...new Set(
    patches.flatMap(({ path }) => (path[0] === 'nodes' && path[1] ? [String(path[1])] : [])),
  ),
]
