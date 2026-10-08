import type { Operation } from '@lacuno/document'
import { applyPatches, invertPatches, type Patch } from '@lacuno/document/patch'
import { type Document, parseDocument } from '@lacuno/schema'
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ApiError, api, message, take } from './api.js'
import { committedHistory, emptyHistory, type HistoryEntry, historyShortcut } from './history.js'
import { catchUp, land, liveStream, type SiteEvent, touchedNodes } from './liveEvents.js'
import type { Preview, PreviewQuery } from './usePreview.js'

export type Snapshot = { document: Document; revision: number }
export type DocumentSession = ReturnType<typeof useDocumentSession>

type Options = {
  /** A viewer's session: it reads and follows the site but never writes. */
  readOnly?: boolean
  /** True while a text editor owns the document: undo, redo and the panels stay put. */
  blocked: boolean
  setPageId: (update: (current: string) => string) => void
  onLeave: () => void
  /** What the canvas shows: each save asks for it rendered in the same answer (usePreview.ts). */
  canvas: () => PreviewQuery
  setPreview: (preview: Preview) => void
}

/** The saved document, everything that writes to it and the undo history over it. */
export function useDocumentSession(
  siteId: string,
  { readOnly = false, blocked, setPageId, onLeave, canvas, setPreview }: Options,
) {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  // 'Saved' until this session lands an edit: the only signal that a save has actually happened.
  const [saved, setSaved] = useState(false)
  const [generation, setGeneration] = useState(0)
  const [editHistory, setEditHistory] = useState(emptyHistory)
  // Every open editing surface registers its flush and clears it again when it closes.
  const flushes = useRef<(() => Promise<boolean>)[]>([])
  const registerFlush = useCallback((flush: () => Promise<boolean>) => {
    flushes.current.push(flush)
    return () => {
      flushes.current = flushes.current.filter((item) => item !== flush)
    }
  }, [])
  const inFlight = useRef(false)
  const autoFlight = useRef(false)
  // Who waits for the save in flight to land: a shortcut pressed meanwhile goes right after it.
  const waiting = useRef<(() => void)[]>([])
  const flushPending = async () => {
    if (inFlight.current) await new Promise<void>((resolve) => waiting.current.push(resolve))
    for (const flush of [...flushes.current]) if (!(await flush())) return false
    return true
  }
  const revision = snapshot?.revision
  const doc = snapshot?.document
  // Nothing may change the document while a save is in flight, edits are pending or it conflicts.
  const unsettled = busy || dirty || conflict
  const frozen = unsettled || blocked
  // Only `load` parses: a committed document is already validated, and parsing it again would
  // rebuild the whole object graph that applyPatches just shared structurally.
  const acceptSnapshot = useCallback(
    (next: Snapshot, { keepPanels = false } = {}) => {
      setSnapshot(next)
      setPageId((current) =>
        next.document.pages[current]
          ? current
          : (Object.values(next.document.pages).find((item) => item.path === '/')?.id ??
            Object.keys(next.document.pages)[0] ??
            ''),
      )
      setConflict(false)
      setError('')
      // An autosave leaves the panel that made it alone: it owns its draft and its dirty flag.
      if (!keepPanels) {
        setDirty(false)
        setGeneration((value) => value + 1)
      }
    },
    [setPageId],
  )
  const load = useCallback(async () => {
    const next = await take<Snapshot>(`/api/sites/${siteId}/document`)
    acceptSnapshot({ ...next, document: parseDocument(next.document) })
    setEditHistory(emptyHistory())
  }, [siteId, acceptSnapshot])
  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])
  // Every batch on the site as the server streams it, newest first, for the activity list.
  const [activity, setActivity] = useState<SiteEvent[]>([])
  // Batches the snapshot has yet to take in: they wait while the designer's own edit settles.
  const queue = useRef<SiteEvent[]>([])
  const stream = useRef<ReturnType<typeof liveStream>>(undefined)
  const reading = useRef(false)
  const loaded = !!snapshot
  useEffect(() => {
    if (!loaded) return
    const live = liveStream(`/api/sites/${siteId}/events`, (event) => {
      queue.current.push(event)
      setActivity((list) => [event, ...list].slice(0, 50))
    })
    stream.current = live
    return () => {
      live.close()
      stream.current = undefined
    }
  }, [siteId, loaded])
  // Apply queued batches once nothing of the designer's is pending: straight into the snapshot,
  // and an agent's batch onto the undo history too, so the designer can take back what their AI
  // did. The panels start over from the new document (they hold no draft now), or their stale
  // values would be saved back. A missing revision means a missed batch, so the document is read
  // again instead.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new batch in `activity` is queued too.
  useEffect(() => {
    if (!snapshot || frozen || inFlight.current || reading.current || !queue.current.length) return
    const { run, gap } = catchUp(queue.current, snapshot.revision)
    queue.current = []
    if (gap) {
      reading.current = true
      api<Snapshot>(`/api/sites/${siteId}/document`)
        .then((next) => {
          acceptSnapshot({ ...next, document: parseDocument(next.document) })
          stream.current?.reopen()
        })
        .catch((e) => setError(e.message))
        .finally(() => {
          reading.current = false
        })
      return
    }
    const last = run.at(-1)
    if (!last) return
    const { document, history } = land(snapshot.document, editHistory, run)
    acceptSnapshot({ document: { ...document, revision: last.revision }, revision: last.revision })
    setEditHistory(history)
    const flash = run.flatMap((event) =>
      event.actor.kind === 'agent' ? touchedNodes(event.patches) : [],
    )
    if (flash.length) window.dispatchEvent(new CustomEvent('lacuno:flash', { detail: flash }))
  }, [snapshot, frozen, activity, siteId, acceptSnapshot, editHistory])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || busy) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy])
  /**
   * A read came back for another revision: the site moved on unless we moved it ourselves or the
   * open stream is about to deliver the batch that moved it.
   */
  const onStale = useCallback(() => {
    if (inFlight.current || stream.current?.open()) return
    setConflict(true)
    setError('This site changed in another session. Reload the latest version to continue.')
  }, [])
  async function leave(action: () => void) {
    if (inFlight.current && !autoFlight.current) return
    if (
      (dirty || busy) &&
      !(await flushPending()) &&
      !window.confirm('Discard your unsaved changes?')
    )
      return
    setDirty(false)
    setSaved(false)
    onLeave()
    action()
  }
  /** Commits one batch and, once it lands, adopts its patches. `step` is the entry undo/redo replays. */
  async function commit(
    body: { operations: Operation[] } | { patches: Patch[] },
    action: 'edit' | 'undo' | 'redo' | 'auto',
    step?: HistoryEntry,
  ) {
    const batch = 'patches' in body ? body.patches : body.operations
    if (readOnly || !snapshot || conflict || inFlight.current || batch.length === 0) return false
    inFlight.current = true
    autoFlight.current = action === 'auto'
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const result = await api<{ revision: number; patches: Patch[]; preview?: Preview }>(
        `/api/sites/${siteId}/document/apply`,
        { expectedRevision: snapshot.revision, ...body, preview: canvas() },
      )
      // The runtime answers again: an event stream it ended while stopped comes back.
      stream.current?.reopen()
      // Invert against the document the server planned from, so an undo restores it exactly.
      const entry = step ?? {
        undo: invertPatches(snapshot.document, result.patches),
        redo: result.patches,
      }
      // Use this commit's patches, not a follow-up read that could include someone else's edits.
      const document = applyPatches(snapshot.document, result.patches)
      flushSync(() => {
        acceptSnapshot(
          { document: { ...document, revision: result.revision }, revision: result.revision },
          { keepPanels: action === 'auto' },
        )
        // Landed with the revision it belongs to, so the canvas never shows an older one.
        if (result.preview) setPreview(result.preview)
        // A batch that changed nothing leaves nothing to undo.
        if (step || result.patches.length)
          setEditHistory(committedHistory(editHistory, action === 'auto' ? 'edit' : action, entry))
        setSaved(true)
      })
      return true
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true)
        setError(
          'This site changed in another session. Your draft is still here. Reload the latest version before editing again.',
        )
      } else setError(message(e, 'Could not save changes'))
      return false
    } finally {
      inFlight.current = false
      autoFlight.current = false
      setBusy(false)
      for (const wake of waiting.current.splice(0)) wake()
    }
  }
  const save = (operations: Operation[], action: 'edit' | 'auto' = 'edit') =>
    commit({ operations }, action)
  const canUndo = !!snapshot && editHistory.undo.length > 0 && !frozen && !readOnly
  const canRedo = !!snapshot && editHistory.redo.length > 0 && !frozen && !readOnly
  function travel(direction: 'undo' | 'redo') {
    if (!(direction === 'undo' ? canUndo : canRedo)) return
    const entry = editHistory[direction].at(-1)
    if (entry) void commit({ patches: entry[direction] }, direction, entry)
  }
  const travelRef = useRef(travel)
  travelRef.current = travel
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.target as Element | null)?.closest?.(
          'input, textarea, select, [contenteditable="true"]',
        )
      )
        return
      const direction = historyShortcut(event)
      if (direction) {
        event.preventDefault()
        travelRef.current(direction)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  /** Reloads the saved document, the same way every reload control does. */
  const reload = () =>
    leave(() => {
      load().catch((e) => setError(e.message))
    })
  return {
    snapshot,
    activity,
    doc,
    revision,
    error,
    setError,
    busy,
    dirty,
    setDirty,
    conflict,
    saved,
    generation,
    unsettled,
    // Every editing control is disabled while frozen; a viewer's session always is.
    frozen: frozen || readOnly,
    readOnly,
    registerFlush,
    flushPending,
    onStale,
    leave,
    reload,
    save,
    canUndo,
    canRedo,
    travel,
  }
}
