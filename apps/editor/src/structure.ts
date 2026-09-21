import type { Operation } from '@freeflow/document'
import { isDescendant, subtreeIds } from '@freeflow/document/references'
import type { Document, Node } from '@freeflow/schema'
import { localClassCopier } from './copyLocalClasses.js'
import { type InsertNode, type PageTree, pageTree } from './history.js'

export const structures = ['section', 'container', 'stack', 'row', 'grid'] as const
export type Structure = (typeof structures)[number]
export const actions = ['link', 'button'] as const
export type Action = (typeof actions)[number]
export type Preset = 'heading' | 'paragraph' | 'image' | Structure | Action
/** Wrap in link builds an `a` around the selection; the palette's Link is a text node. */
type Buildable = Preset | 'link-wrapper'
export const wrappers = [...structures, 'link'] as const
export type Wrapper = (typeof wrappers)[number]
export type Placement = 'inside' | 'after' | 'page'
const containers = new Set([
  'div',
  'main',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'nav',
  'li',
  'figure',
  'figcaption',
])

/** Definitions stay protected unless explicitly opened in the shared-component editor. */
export function structureRestriction(doc: Document, id: string): string | undefined {
  const roots = new Set(Object.values(doc.components).map((component) => component.root))
  for (let current: string | null = id; current; current = doc.nodes[current]?.parent ?? null) {
    const node = doc.nodes[current]
    if (!node) return 'This element no longer exists.'
    if (node.meta?.locked) return 'This element or one of its parents is locked.'
    if (node.type === 'slot') return 'Slots are not editable here yet.'
    if (roots.has(current) || (node.type === 'component' && current !== id))
      return 'Component structure is protected. Open the shared design to edit it.'
    if (node.type === 'collection-list') return 'Collection structure editing comes later.'
  }
  return undefined
}

/** True when this node or any ancestor is locked. */
export function isLocked(doc: Document, id: string) {
  for (let current: string | null = id; current; current = doc.nodes[current]?.parent ?? null)
    if (doc.nodes[current]?.meta?.locked) return true
  return false
}

/** True when this node sits inside a link: nested anchors are invalid HTML. */
export function hasAnchorParent(doc: Document, node: Node): boolean {
  for (
    let parent = node.parent ? doc.nodes[node.parent] : undefined;
    parent;
    parent = parent.parent ? doc.nodes[parent.parent] : undefined
  ) {
    if ('tag' in parent && parent.tag === 'a') return true
  }
  return false
}

/** The page a node belongs to, so a new link can point at it. Empty inside a component. */
export function pageOf(doc: Document, id: string): string {
  let root = id
  for (let parent = doc.nodes[root]?.parent; parent; parent = doc.nodes[root]?.parent) root = parent
  return Object.values(doc.pages).find((page) => page.root === root)?.id ?? ''
}

/** True when this node or any ancestor is the shared root of a component definition. */
export function isShared(doc: Document, id: string) {
  const roots = new Set(Object.values(doc.components).map((component) => component.root))
  for (let current: string | null = id; current; current = doc.nodes[current]?.parent ?? null)
    if (roots.has(current)) return true
  return false
}

const tagLabels: Record<string, string> = {
  div: 'Container',
  section: 'Section',
  p: 'Paragraph',
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
  h4: 'Heading',
  h5: 'Heading',
  h6: 'Heading',
}

/** The name shown for an element in the layers, breadcrumbs, drag labels and the inspector. */
export function nodeLabel(node: Node) {
  if (node.meta?.label) return node.meta.label
  return 'tag' in node ? (tagLabels[node.tag] ?? node.tag) : node.type
}

export function insertionTarget(
  doc: Document,
  pageRoot: string,
  selected: string,
  placement: Placement,
) {
  const target = placement === 'page' ? pageRoot : selected
  if (!target) throw new Error('Select an element first.')
  const restriction = structureRestriction(doc, target)
  if (restriction) throw new Error(restriction)
  const node = doc.nodes[target]!
  const parent = placement === 'after' ? (node.parent ? doc.nodes[node.parent] : undefined) : node
  if (parent?.type !== 'element' || !containers.has(parent.tag))
    throw new Error('Choose a section or container for this element.')
  return {
    parent: parent.id,
    index: placement === 'after' ? parent.children.indexOf(target) + 1 : parent.children.length,
  }
}

export function siblingMove(doc: Document, id: string, direction: -1 | 1): Operation | undefined {
  if (structureRestriction(doc, id)) return undefined
  const node = doc.nodes[id]
  const parent = node?.parent ? doc.nodes[node.parent] : undefined
  if (!parent) return undefined
  const from = parent.children.indexOf(id)
  const index = from + direction
  if (from < 0 || index < 0 || index >= parent.children.length) return undefined
  if (doc.nodes[parent.children[index]!]!.meta?.locked) return undefined
  return { type: 'node.move', id, parent: parent.id, index }
}

export function presetNode(
  preset: Buildable,
  classId: string,
  assetId = '',
  pageId = '',
): InsertNode {
  const makeId = () => `n-${crypto.randomUUID()}`
  const text = (tag: string, label: string, value: string): InsertNode => ({
    id: makeId(),
    type: 'text',
    tag,
    classes: [],
    text: { type: 'static', value },
    meta: { label },
  })
  if (preset === 'image') {
    return {
      id: makeId(),
      type: 'element',
      tag: 'img',
      classes: classId ? [classId] : [],
      attrs: {
        ...(assetId ? { src: { type: 'asset' as const, asset: assetId } } : {}),
        alt: { type: 'static', value: '' },
      },
      meta: { label: 'Image' },
      children: [],
    }
  }
  const classes = classId ? [classId] : []
  // A page binding keeps the link pointing at the page after a path change.
  const href = pageId ? { attrs: { href: { type: 'page' as const, page: pageId } } } : {}
  if (preset === 'heading') return { ...text('h2', 'Heading', 'Your new heading'), classes }
  if (preset === 'paragraph')
    return { ...text('p', 'Paragraph', 'Write something worth sharing.'), classes }
  if (preset === 'link' || preset === 'button') {
    const label = preset === 'link' ? 'Link' : 'Button'
    return { ...text('a', label, label), classes, ...href }
  }
  if (preset === 'link-wrapper')
    return {
      id: makeId(),
      type: 'element',
      tag: 'a',
      classes,
      ...href,
      meta: { label: 'Link' },
      children: [],
    }
  return {
    id: makeId(),
    type: 'element',
    tag: preset === 'section' ? 'section' : 'div',
    classes,
    meta: { label: preset[0]!.toUpperCase() + preset.slice(1) },
    children:
      preset === 'section'
        ? [
            text('h2', 'Section heading', 'A new section'),
            text('p', 'Section paragraph', 'Start shaping your next idea.'),
          ]
        : [],
  }
}

const defaults: Record<Structure | 'image' | 'button' | 'link-wrapper', Record<string, string>> = {
  image: {
    display: 'block',
    'max-width': '100%',
    width: '100%',
    height: 'auto',
    'object-fit': 'cover',
    'object-position': '50% 50%',
  },
  section: { padding: '48px 24px', 'box-sizing': 'border-box' },
  container: { width: '100%', 'max-width': '1100px', margin: '0 auto', 'box-sizing': 'border-box' },
  stack: { display: 'flex', 'flex-direction': 'column', gap: '16px' },
  row: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '16px' },
  grid: { display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', gap: '16px' },
  button: {
    display: 'inline-block',
    padding: '12px 20px',
    'border-radius': '8px',
    background: '#6434d9',
    color: 'white',
    'text-decoration': 'none',
    'font-weight': '600',
  },
  'link-wrapper': { display: 'block', color: 'inherit', 'text-decoration': 'none' },
}

export function structureInsertion(
  preset: Buildable,
  target: { parent: string; index: number },
  classId = '',
  empty = false,
  assetId = '',
  pageId = '',
): { node: InsertNode; operations: Operation[] } {
  const node = presetNode(preset, classId, assetId, pageId)
  if (empty) node.children = []
  const operations: Operation[] = []
  if (preset in defaults) {
    const id = `c-${crypto.randomUUID()}`
    node.classes.push(id)
    operations.push({ type: 'class.create', id, local: true })
    for (const [property, value] of Object.entries(defaults[preset as keyof typeof defaults])) {
      operations.push({
        type: 'style.set',
        class: id,
        breakpoint: 'base',
        state: 'none',
        property,
        value: { type: 'raw', value },
      })
    }
  }
  operations.push({ type: 'node.create', ...target, node })
  return { node, operations }
}

/** Why this wrapper cannot go around the selection, if it cannot. */
export function wrapRestriction(doc: Document, id: string, preset: Wrapper): string | undefined {
  try {
    insertionTarget(doc, '', id, 'after')
  } catch (error) {
    return (error as Error).message
  }
  const node = doc.nodes[id]!
  if (preset === 'link' && (('tag' in node && node.tag === 'a') || hasAnchorParent(doc, node)))
    return 'A link cannot be wrapped in another link.'
}

export function wrapSelection(doc: Document, id: string, preset: Wrapper) {
  const reason = wrapRestriction(doc, id, preset)
  if (reason) throw new Error(reason)
  const target = insertionTarget(doc, '', id, 'after')
  const result = structureInsertion(
    preset === 'link' ? 'link-wrapper' : preset,
    { ...target, index: target.index - 1 },
    '',
    true,
    '',
    pageOf(doc, id),
  )
  result.operations.push({ type: 'node.move', id, parent: result.node.id, index: 0 })
  return result
}

export type DropPosition = 'before' | 'inside' | 'after'
export type DragItem = { preset: Preset; classId?: string; assetId?: string } | { id: string }

export function canContain(doc: Document, id: string) {
  const node = doc.nodes[id]
  return node?.type === 'element' && containers.has(node.tag)
}

/** Resolve a visual insertion boundary to the index after removing the dragged node. */
export function dropTarget(
  doc: Document,
  root: string,
  item: DragItem,
  id: string,
  position: DropPosition,
) {
  const belongs = (nodeId: string) => nodeId === root || isDescendant(doc, root, nodeId)
  if (!belongs(id) || structureRestriction(doc, id))
    throw new Error('This element cannot receive a drop.')
  const node = doc.nodes[id]!
  const parent = position === 'inside' ? id : node.parent
  if (!parent || !canContain(doc, parent))
    throw new Error('Drop inside a container or beside an element.')
  let index =
    position === 'inside'
      ? doc.nodes[parent]!.children.length
      : doc.nodes[parent]!.children.indexOf(id) + (position === 'after' ? 1 : 0)
  if ('id' in item) {
    const source = doc.nodes[item.id]
    if (
      !source?.parent ||
      item.id === root ||
      !belongs(item.id) ||
      structureRestriction(doc, item.id)
    )
      throw new Error('This element cannot be moved.')
    if (parent === item.id || isDescendant(doc, item.id, parent))
      throw new Error('An element cannot contain itself.')
    if (source.parent === parent && doc.nodes[parent]!.children.indexOf(item.id) < index) index--
  }
  return { parent, index }
}

export function dropEdit(
  doc: Document,
  root: string,
  item: DragItem,
  id: string,
  position: DropPosition,
) {
  const target = dropTarget(doc, root, item, id, position)
  if ('preset' in item)
    return structureInsertion(
      item.preset,
      target,
      item.classId,
      false,
      item.assetId,
      pageOf(doc, root),
    )
  const node = doc.nodes[item.id]!
  const unchanged =
    node.parent === target.parent && doc.nodes[target.parent]!.children[target.index] === item.id
  return {
    node,
    operations: unchanged ? [] : [{ type: 'node.move', id: item.id, ...target } as Operation],
  }
}

export function subtreeRestriction(doc: Document, id: string): string | undefined {
  if (!doc.nodes[id]) return 'Select an element first.'
  const reason = structureRestriction(doc, id)
  if (reason) return reason
  const node = doc.nodes[id]!
  if (!node.parent) return 'The page root cannot be duplicated or deleted.'
  if (node.type !== 'element' && node.type !== 'text' && node.type !== 'component')
    return 'This element is not supported yet.'
  if (node.type === 'component' && node.overrides?.length)
    return 'Subtree overrides cannot be edited here yet.'
  for (const child of node.children) {
    const restriction = subtreeRestriction(doc, child)
    if (restriction) return restriction
  }
}

/** A deep copy with fresh node ids, copied local classes and in-page references remapped. */
export function copySubtree(doc: Document, id: string, operations: Operation[]): PageTree {
  const copyClasses = localClassCopier(doc, operations)
  const htmlIds = new Map<string, string>()
  for (const nodeId of subtreeIds(doc, id)) {
    const value = doc.nodes[nodeId]!.attrs?.id
    if (value?.type === 'static' && typeof value.value === 'string')
      htmlIds.set(value.value, `${value.value}-copy-${crypto.randomUUID().slice(0, 8)}`)
  }
  const copy = (tree: PageTree): PageTree => {
    for (const [attribute, binding] of Object.entries(tree.attrs ?? {})) {
      if (binding.type !== 'static' || typeof binding.value !== 'string') continue
      if (attribute === 'id') binding.value = htmlIds.get(binding.value) ?? binding.value
      else if (attribute === 'href' && binding.value.startsWith('#'))
        binding.value = `#${htmlIds.get(binding.value.slice(1)) ?? binding.value.slice(1)}`
      else if (
        [
          'for',
          'aria-labelledby',
          'aria-describedby',
          'aria-controls',
          'aria-owns',
          'headers',
          'list',
          'form',
        ].includes(attribute)
      )
        binding.value = binding.value
          .split(/\s+/)
          .map((value) => htmlIds.get(value) ?? value)
          .join(' ')
    }
    return {
      ...tree,
      id: `n-${crypto.randomUUID()}`,
      classes: copyClasses(tree.classes),
      children: tree.children.map(copy),
    }
  }
  return copy(pageTree(doc, id))
}

export function duplicateSelection(doc: Document, id: string) {
  const reason = subtreeRestriction(doc, id)
  if (reason) throw new Error(reason)
  const operations: Operation[] = []
  const node = copySubtree(doc, id, operations)
  node.meta = { ...node.meta, label: `${nodeLabel(doc.nodes[id]!)} copy` }
  operations.push({ type: 'node.create', ...insertionTarget(doc, '', id, 'after'), node })
  return { node, operations }
}
