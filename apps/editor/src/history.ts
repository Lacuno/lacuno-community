import type { Patch } from '@freeflow/document/patch'
import type { Document, ElementNode, Node, TextNode } from '@freeflow/schema'

type DefinedFields<T> = { [K in keyof T]: Exclude<T[K], undefined> }
export type InsertNode = (
  | DefinedFields<Omit<ElementNode, 'parent' | 'children'>>
  | DefinedFields<Omit<TextNode, 'parent' | 'children'>>
  | DefinedFields<Omit<Extract<Node, { type: 'embed' }>, 'parent' | 'children'>>
) & { children?: InsertNode[] }

type TreeFields<T> = T extends Node
  ? DefinedFields<Omit<T, 'parent' | 'children' | 'overrides'>>
  : never
export type PageTree = TreeFields<Exclude<Node, { type: 'code-component' }>> & {
  children: PageTree[]
}
export function pageTree(doc: Document, id: string): PageTree {
  const node = doc.nodes[id]!
  if (node.type === 'code-component' || (node.type === 'component' && node.overrides?.length))
    throw new Error('Code components and instance overrides cannot be copied or deleted yet.')
  const { parent: _, children, ...fields } = structuredClone(node)
  return { ...fields, children: children.map((child) => pageTree(doc, child)) } as PageTree
}

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
