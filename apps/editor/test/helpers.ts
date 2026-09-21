import { type DocumentStore, invertPatches, type Operation } from '@freeflow/document'
import type { HistoryEntry } from '../src/history.js'

/** Saves one batch the way the editor does and keeps the patches that undo and redo it. */
export async function commit(store: DocumentStore, operations: Operation[]): Promise<HistoryEntry> {
  const before = store.read().document
  const { patches } = await store.apply({ expectedRevision: store.revision, operations })
  return { undo: invertPatches(before, patches), redo: patches }
}
