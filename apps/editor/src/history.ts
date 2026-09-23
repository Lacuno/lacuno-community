import type { Patch } from '@freeflow/document/patch'

/** One saved batch, as the patches that reverse it and the patches that replay it. */
export type HistoryEntry = { undo: Patch[]; redo: Patch[] }
export type EditHistory = { undo: HistoryEntry[]; redo: HistoryEntry[] }
export const emptyHistory = (): EditHistory => ({ undo: [], redo: [] })

export function historyShortcut(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
): 'undo' | 'redo' | undefined {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey) return undefined
  const key = event.key.toLowerCase()
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (key === 'y' && event.ctrlKey && !event.shiftKey) return 'redo'
  return undefined
}

/** Move history only after a successful commit. New edits discard the redo branch. */
export function committedHistory(
  history: EditHistory,
  action: 'edit' | 'undo' | 'redo',
  entry: HistoryEntry,
): EditHistory {
  if (action === 'undo') return { undo: history.undo.slice(0, -1), redo: [...history.redo, entry] }
  if (action === 'redo') return { undo: [...history.undo, entry], redo: history.redo.slice(0, -1) }
  return { undo: [...history.undo, entry].slice(-100), redo: [] }
}
