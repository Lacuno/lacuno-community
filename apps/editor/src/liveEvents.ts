import { applyPatches, invertPatches, type Patch } from '@lacuno/document/patch'
import type { Document } from '@lacuno/schema'
import { committedHistory, type EditHistory } from './history.js'

/** One committed batch on the site, as the server's event stream sends it. */
export type SiteEvent = {
  revision: number
  patches: Patch[]
  /** An agent's `user` is who connected it, named behind a gateway. */
  actor: { kind: 'editor' } | { kind: 'agent'; app: string; user?: string }
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

/**
 * The document after `run` lands on it, with each agent's batch on the undo history as one step,
 * so the designer can take back what their AI did. Another editor's batches are that editor's
 * steps and stay off the history.
 */
export function land(document: Document, history: EditHistory, run: SiteEvent[]) {
  for (const event of run) {
    if (event.actor.kind === 'agent')
      history = committedHistory(history, 'edit', {
        undo: invertPatches(document, event.patches),
        redo: event.patches,
      })
    document = applyPatches(document, event.patches)
  }
  return { document, history }
}

/**
 * A site's event stream. A runtime that stops ends it with a 204, and EventSource then gives up
 * for good; `reopen` opens it again, which the session calls after a request reached the runtime.
 * A forgotten tab therefore never wakes a stopped runtime.
 */
export function liveStream(url: string, onBatch: (event: SiteEvent) => void) {
  let source: EventSource
  const open = () => {
    source = new EventSource(url)
    source.addEventListener('batch', (message) => onBatch(JSON.parse(message.data)))
  }
  open()
  return {
    open: () => source.readyState === EventSource.OPEN,
    reopen: () => {
      if (source.readyState === EventSource.CLOSED) open()
    },
    close: () => source.close(),
  }
}
