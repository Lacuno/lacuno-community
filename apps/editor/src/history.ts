import type { Document, ElementNode, StyleDecl, TextNode } from '@freeflow/schema'
import { styleKey } from '@freeflow/schema'

type DefinedFields<T> = { [K in keyof T]: Exclude<T[K], undefined> }
export type InsertNode = (
  | DefinedFields<Omit<ElementNode, 'parent' | 'children'>>
  | DefinedFields<Omit<TextNode, 'parent' | 'children'>>
) & { children?: InsertNode[] }

export type EditOperation =
  | { type: 'node.update'; id: string; text: TextNode['text'] }
  | { type: 'node.create'; parent: string; index?: number; node: InsertNode }
  | { type: 'node.move'; id: string; parent: string; index: number }
  | { type: 'node.delete'; id: string }
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
  const position = (id: string) => {
    const parent = draft.nodes[id]?.parent
    const index = parent ? draft.nodes[parent]?.children.indexOf(id) : undefined
    if (!parent || index === undefined || index < 0)
      throw new Error('Cannot change a root or detached element')
    return { parent, index }
  }
  const literal = (id: string): InsertNode => {
    const node = draft.nodes[id]
    if (!node || (node.type !== 'element' && node.type !== 'text'))
      throw new Error('This element cannot be restored by the editor yet')
    const { parent: _, children, ...fields } = node
    return { ...structuredClone(fields), children: children.map(literal) } as InsertNode
  }
  const materialize = (node: InsertNode, parent: string) => {
    if (draft.nodes[node.id]) throw new Error('Element ID already exists')
    const { children = [], ...fields } = node
    draft.nodes[node.id] = {
      ...structuredClone(fields),
      parent,
      children: children.map((child) => child.id),
    }
    for (const child of children) materialize(child, node.id)
  }
  const remove = (id: string) => {
    for (const child of draft.nodes[id]?.children ?? []) remove(child)
    delete draft.nodes[id]
  }
  for (const operation of operations) {
    if (operation.type === 'node.create') {
      const parent = draft.nodes[operation.parent]
      if (!parent) throw new Error('Insertion parent no longer exists')
      const index = operation.index ?? parent.children.length
      if (index < 0 || index > parent.children.length) throw new Error('Invalid insertion position')
      materialize(operation.node, operation.parent)
      parent.children.splice(index, 0, operation.node.id)
      undo.unshift({ type: 'node.delete', id: operation.node.id })
    } else if (operation.type === 'node.delete') {
      const before = position(operation.id)
      undo.unshift({ type: 'node.create', ...before, node: literal(operation.id) })
      draft.nodes[before.parent]!.children.splice(before.index, 1)
      remove(operation.id)
    } else if (operation.type === 'node.move') {
      const before = position(operation.id)
      const target = draft.nodes[operation.parent]
      if (!target) throw new Error('Move parent no longer exists')
      for (let id: string | null = operation.parent; id; id = draft.nodes[id]?.parent ?? null) {
        if (id === operation.id) throw new Error('Cannot move an element inside itself')
      }
      const limit = target.children.length - (before.parent === operation.parent ? 1 : 0)
      if (operation.index < 0 || operation.index > limit) throw new Error('Invalid move position')
      draft.nodes[before.parent]!.children.splice(before.index, 1)
      target.children.splice(operation.index, 0, operation.id)
      draft.nodes[operation.id]!.parent = operation.parent
      undo.unshift({ type: 'node.move', id: operation.id, ...before })
    } else if (operation.type === 'node.update') {
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
