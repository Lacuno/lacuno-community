import type {
  AssetRef,
  Component,
  ComponentInstanceNode,
  CssValue,
  DesignToken,
  Document,
  ElementNode,
  Node,
  Page,
  StyleDecl,
  TextNode,
} from '@freeflow/schema'
import { styleKey } from '@freeflow/schema'

type DefinedFields<T> = { [K in keyof T]: Exclude<T[K], undefined> }
export type InsertNode = (
  | DefinedFields<Omit<ElementNode, 'parent' | 'children'>>
  | DefinedFields<Omit<TextNode, 'parent' | 'children'>>
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

export type EditOperation =
  | { type: 'component.unextract'; id: string; instance: string }
  | ({ type: 'component.create'; root: PageTree } & Omit<Component, 'root'>)
  | { type: 'component.delete'; id: string }
  | { type: 'component.update'; id: string; name?: string; props?: Component['props'] }
  | {
      type: 'component.extract'
      node: string
      id: string
      instance: string
      name: string
      props: Component['props']
    }
  | ({ type: 'page.create'; root: PageTree } & Omit<Page, 'root'>)
  | { type: 'page.update'; id: string; name?: string; path?: string; seo?: Page['seo'] | null }
  | { type: 'page.delete'; id: string }
  | {
      type: 'node.update'
      id: string
      text?: TextNode['text']
      classes?: string[]
      meta?: NonNullable<ElementNode['meta']> | null
      attrs?: NonNullable<ElementNode['attrs']> | null
      props?: ComponentInstanceNode['props'] | null
    }
  | ({ type: 'asset.create' } & AssetRef)
  | { type: 'asset.delete'; id: string }
  | {
      type: 'class.create'
      id: string
      name?: string
      local?: boolean
      preset?: boolean
      combo?: string[]
      locked?: boolean
    }
  | { type: 'class.delete'; id: string }
  | (DefinedFields<DesignToken> & { type: 'designToken.create' })
  | { type: 'designToken.delete'; id: string }
  | { type: 'designToken.setValue'; id: string; mode: string; value: CssValue }
  | { type: 'designToken.clearValue'; id: string; mode: string }
  | { type: 'node.create'; parent: string; index?: number; node: InsertNode | PageTree }
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
  const literal = (id: string) => pageTree(draft, id)
  const materialize = (node: InsertNode | PageTree, parent: string | null) => {
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
    if (operation.type === 'component.extract') {
      const before = position(operation.node)
      draft.nodes[before.parent]!.children[before.index] = operation.instance
      draft.nodes[operation.node]!.parent = null
      draft.components[operation.id] = {
        id: operation.id,
        root: operation.node,
        name: operation.name,
        props: structuredClone(operation.props),
      }
      draft.nodes[operation.instance] = {
        id: operation.instance,
        type: 'component',
        component: operation.id,
        parent: before.parent,
        children: [],
        classes: [],
      }
      undo.unshift({ type: 'component.unextract', id: operation.id, instance: operation.instance })
    } else if (operation.type === 'component.unextract') {
      const component = draft.components[operation.id]!
      const before = position(operation.instance)
      undo.unshift({
        type: 'component.extract',
        id: component.id,
        instance: operation.instance,
        node: component.root,
        name: component.name,
        props: structuredClone(component.props),
      })
      draft.nodes[before.parent]!.children[before.index] = component.root
      draft.nodes[component.root]!.parent = before.parent
      delete draft.nodes[operation.instance]
      delete draft.components[component.id]
    } else if (operation.type === 'component.create') {
      const { type: _, root, ...component } = operation
      materialize(root, null)
      draft.components[component.id] = { ...structuredClone(component), root: root.id }
      undo.unshift({ type: 'component.delete', id: component.id })
    } else if (operation.type === 'component.delete') {
      const component = draft.components[operation.id]!
      undo.unshift({
        type: 'component.create',
        ...structuredClone(component),
        root: literal(component.root),
      })
      remove(component.root)
      delete draft.components[component.id]
    } else if (operation.type === 'component.update') {
      const component = draft.components[operation.id]!
      undo.unshift({
        type: 'component.update',
        id: component.id,
        ...(operation.name !== undefined ? { name: component.name } : {}),
        ...(operation.props ? { props: structuredClone(component.props) } : {}),
      })
      if (operation.name !== undefined) component.name = operation.name
      if (operation.props) component.props = structuredClone(operation.props)
    } else if (operation.type === 'page.create') {
      const { type: _, root, ...page } = operation
      materialize(root, null)
      draft.pages[page.id] = { ...structuredClone(page), root: root.id }
      undo.unshift({ type: 'page.delete', id: page.id })
    } else if (operation.type === 'page.delete') {
      const page = draft.pages[operation.id]
      if (!page) throw new Error('Page no longer exists')
      undo.unshift({
        type: 'page.create',
        ...structuredClone(page),
        root: pageTree(draft, page.root),
      })
      remove(page.root)
      delete draft.pages[page.id]
    } else if (operation.type === 'page.update') {
      const page = draft.pages[operation.id]
      if (!page) throw new Error('Page no longer exists')
      const inverse: EditOperation = { type: 'page.update', id: page.id }
      if (operation.name !== undefined) {
        inverse.name = page.name
        page.name = operation.name
      }
      if (operation.path !== undefined) {
        inverse.path = page.path
        page.path = operation.path
      }
      if (operation.seo !== undefined) {
        inverse.seo = structuredClone(page.seo ?? null)
        if (operation.seo === null) delete page.seo
        else page.seo = structuredClone(operation.seo)
      }
      undo.unshift(inverse)
    } else if (operation.type === 'asset.create') {
      const { type: _, ...asset } = operation
      draft.assets[asset.id] = structuredClone(asset)
      undo.unshift({ type: 'asset.delete', id: asset.id })
    } else if (operation.type === 'asset.delete') {
      const asset = draft.assets[operation.id]
      if (!asset) throw new Error('Image no longer exists')
      undo.unshift({ type: 'asset.create', ...structuredClone(asset) })
      delete draft.assets[operation.id]
    } else if (operation.type === 'node.create') {
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
      if (!node) throw new Error('Element no longer exists')
      const inverse: EditOperation = { type: 'node.update', id: operation.id }
      if (operation.props !== undefined) {
        if (node.type !== 'component') throw new Error('Only component instances have properties')
        inverse.props = structuredClone(node.props ?? null)
        if (operation.props === null) delete node.props
        else node.props = structuredClone(operation.props)
      }
      if (operation.text !== undefined) {
        if (node.type !== 'text') throw new Error('Cannot record a text edit for this element')
        inverse.text = structuredClone(node.text)
        node.text = structuredClone(operation.text)
      }
      if (operation.attrs !== undefined) {
        inverse.attrs = node.attrs ? structuredClone(node.attrs) : null
        if (operation.attrs === null) delete node.attrs
        else node.attrs = structuredClone(operation.attrs)
      }
      if (operation.meta !== undefined) {
        inverse.meta = node.meta ? structuredClone(node.meta) : null
        if (operation.meta === null) delete node.meta
        else node.meta = structuredClone(operation.meta)
      }
      if (operation.classes !== undefined) {
        inverse.classes = [...node.classes]
        node.classes = [...operation.classes]
      }
      undo.unshift(inverse)
    } else if (operation.type === 'class.create') {
      if (draft.classes[operation.id]) throw new Error('Class already exists')
      draft.classes[operation.id] = {
        id: operation.id,
        ...(operation.name !== undefined ? { name: operation.name } : {}),
        kind: operation.local ? 'local' : 'class',
        ...(operation.combo?.length ? { combo: [...operation.combo] } : {}),
        ...(operation.locked ? { locked: true } : {}),
        ...(operation.preset ? { preset: true } : {}),
      }
      undo.unshift({ type: 'class.delete', id: operation.id })
    } else if (operation.type === 'class.delete') {
      const cls = draft.classes[operation.id]
      if (!cls || (cls.kind === 'class' && !cls.name))
        throw new Error('This class cannot be restored by the editor yet')
      const styles = Object.entries(draft.styles).filter(
        ([, style]) => style.class === operation.id,
      )
      undo.unshift(
        {
          type: 'class.create',
          id: cls.id,
          ...(cls.name !== undefined ? { name: cls.name } : {}),
          ...(cls.kind === 'local' ? { local: true } : {}),
          ...(cls.combo?.length ? { combo: [...cls.combo] } : {}),
          ...(cls.locked ? { locked: true } : {}),
          ...(cls.preset ? { preset: true } : {}),
        },
        ...styles.map(([, style]) => ({ type: 'style.set' as const, ...structuredClone(style) })),
      )
      for (const [key] of styles) delete draft.styles[key]
      delete draft.classes[operation.id]
    } else if (operation.type === 'designToken.create') {
      if (draft.designTokens[operation.id]) throw new Error('Color already exists')
      const { type: _, ...token } = operation
      draft.designTokens[operation.id] = structuredClone(token)
      undo.unshift({ type: 'designToken.delete', id: operation.id })
    } else if (operation.type === 'designToken.delete') {
      const token = draft.designTokens[operation.id]
      if (!token) throw new Error('Color no longer exists')
      undo.unshift({
        type: 'designToken.create',
        id: token.id,
        name: token.name,
        group: token.group,
        values: structuredClone(token.values),
        ...(token.description !== undefined ? { description: token.description } : {}),
      })
      delete draft.designTokens[operation.id]
    } else if (
      operation.type === 'designToken.setValue' ||
      operation.type === 'designToken.clearValue'
    ) {
      const token = draft.designTokens[operation.id]
      if (!token) throw new Error('Color no longer exists')
      const before = token.values[operation.mode]
      undo.unshift(
        before
          ? {
              type: 'designToken.setValue',
              id: operation.id,
              mode: operation.mode,
              value: structuredClone(before),
            }
          : { type: 'designToken.clearValue', id: operation.id, mode: operation.mode },
      )
      if (operation.type === 'designToken.setValue')
        token.values[operation.mode] = structuredClone(operation.value)
      else delete token.values[operation.mode]
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
