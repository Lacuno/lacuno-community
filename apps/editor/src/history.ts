import type { Document, StyleDecl, TextNode } from '@freeflow/schema'
import { styleKey } from '@freeflow/schema'

export type EditOperation =
  | { type: 'node.update'; id: string; text: TextNode['text'] }
  | ({ type: 'style.set' } & StyleDecl)
  | ({ type: 'style.clear' } & Pick<StyleDecl, 'class' | 'breakpoint' | 'state' | 'property'>)

export type HistoryEntry = { undo: EditOperation[]; redo: EditOperation[] }
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

/** Invert named edits before sending them. Typed values and absent declarations round-trip exactly. */
export function captureEdit(document: Document, operations: EditOperation[]): HistoryEntry {
  const draft = structuredClone(document)
  const undo: EditOperation[] = []
  for (const operation of operations) {
    if (operation.type === 'node.update') {
      const node = draft.nodes[operation.id]
      if (node?.type !== 'text') throw new Error('Cannot record a text edit for this element')
      undo.unshift({ type: 'node.update', id: operation.id, text: structuredClone(node.text) })
      node.text = structuredClone(operation.text)
    } else {
      const key = styleKey(operation)
      const before = draft.styles[key]
      if (before) undo.unshift({ type: 'style.set', ...structuredClone(before) })
      else
        undo.unshift({
          type: 'style.clear',
          class: operation.class,
          breakpoint: operation.breakpoint,
          state: operation.state,
          property: operation.property,
        })
      if (operation.type === 'style.clear') {
        if (!before) throw new Error('Cannot clear a missing style declaration')
        delete draft.styles[key]
      } else {
        const { type: _, ...style } = operation
        draft.styles[key] = structuredClone(style)
      }
    }
  }
  return { undo, redo: structuredClone(operations) }
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
