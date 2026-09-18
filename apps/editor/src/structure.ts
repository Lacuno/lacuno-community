import type { Document } from '@freeflow/schema'
import type { EditOperation, InsertNode } from './history.js'

export const structures = ['section', 'container', 'stack', 'row', 'grid'] as const
export type Structure = (typeof structures)[number]
export type Preset = 'heading' | 'paragraph' | Structure
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

/** Structural changes in this milestone are limited to unlocked page-owned elements. */
export function structureRestriction(doc: Document, id: string): string | undefined {
  const roots = new Set(Object.values(doc.components).map((component) => component.root))
  for (let current: string | null = id; current; current = doc.nodes[current]?.parent ?? null) {
    const node = doc.nodes[current]
    if (!node) return 'This element no longer exists.'
    if (node.meta?.locked) return 'This element or one of its parents is locked.'
    if (roots.has(current) || node.type === 'component' || node.type === 'slot')
      return 'Component structure editing comes later.'
    if (node.type === 'collection-list') return 'Collection structure editing comes later.'
  }
  return undefined
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

export function siblingMove(
  doc: Document,
  id: string,
  direction: -1 | 1,
): EditOperation | undefined {
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
  preset: Preset,
  classId: string,
  makeId = () => `n-${crypto.randomUUID()}`,
): InsertNode {
  const text = (tag: string, label: string, value: string): InsertNode => ({
    id: makeId(),
    type: 'text',
    tag,
    classes: [],
    text: { type: 'static', value },
    meta: { label },
  })
  const classes = classId ? [classId] : []
  if (preset === 'heading') return { ...text('h2', 'Heading', 'Your new heading'), classes }
  if (preset === 'paragraph')
    return { ...text('p', 'Paragraph', 'Write something worth sharing.'), classes }
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

const defaults: Record<Structure, Record<string, string>> = {
  section: { padding: '48px 24px', 'box-sizing': 'border-box' },
  container: { width: '100%', 'max-width': '1100px', margin: '0 auto', 'box-sizing': 'border-box' },
  stack: { display: 'flex', 'flex-direction': 'column', gap: '16px' },
  row: { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', gap: '16px' },
  grid: { display: 'grid', 'grid-template-columns': 'repeat(3, minmax(0, 1fr))', gap: '16px' },
}

export function structureInsertion(
  preset: Preset,
  target: { parent: string; index: number },
  classId = '',
  empty = false,
): { node: InsertNode; operations: EditOperation[] } {
  const node = presetNode(preset, classId)
  if (empty) node.children = []
  const operations: EditOperation[] = []
  if (preset in defaults) {
    const id = `c-${crypto.randomUUID()}`
    node.classes.push(id)
    operations.push({ type: 'class.create', id, local: true })
    for (const [property, value] of Object.entries(defaults[preset as Structure])) {
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

export function wrapSelection(doc: Document, id: string, preset: Structure) {
  const target = insertionTarget(doc, '', id, 'after')
  const result = structureInsertion(preset, { ...target, index: target.index - 1 }, '', true)
  result.operations.push({ type: 'node.move', id, parent: result.node.id, index: 0 })
  return result
}

export type DropPosition = 'before' | 'inside' | 'after'
export type DragItem = { preset: Preset; classId?: string } | { id: string }

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
  const belongs = (nodeId: string) => {
    for (let current: string | null = nodeId; current; current = doc.nodes[current]?.parent ?? null)
      if (current === root) return true
    return false
  }
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
    for (let current: string | null = parent; current; current = doc.nodes[current]?.parent ?? null)
      if (current === item.id) throw new Error('An element cannot contain itself.')
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
  if ('preset' in item) return structureInsertion(item.preset, target, item.classId)
  const node = doc.nodes[item.id]!
  const unchanged =
    node.parent === target.parent && doc.nodes[target.parent]!.children[target.index] === item.id
  return {
    node,
    operations: unchanged ? [] : [{ type: 'node.move', id: item.id, ...target } as EditOperation],
  }
}

export function subtreeRestriction(doc: Document, id: string): string | undefined {
  if (!doc.nodes[id]) return 'Select an element first.'
  const reason = structureRestriction(doc, id)
  if (reason) return reason
  const node = doc.nodes[id]!
  if (!node.parent) return 'The page root cannot be duplicated or deleted.'
  if (node.type !== 'element' && node.type !== 'text') return 'This element is not supported yet.'
  for (const child of node.children) {
    const restriction = subtreeRestriction(doc, child)
    if (restriction) return restriction
  }
}

export function duplicateSelection(doc: Document, id: string) {
  const reason = subtreeRestriction(doc, id)
  if (reason) throw new Error(reason)
  const operations: EditOperation[] = []
  const locals = new Map<string, string>()
  const htmlIds = new Map<string, string>()
  const collect = (nodeId: string) => {
    const node = doc.nodes[nodeId]!
    const value = node.attrs?.id
    if (value?.type === 'static' && typeof value.value === 'string')
      htmlIds.set(value.value, `${value.value}-copy-${crypto.randomUUID().slice(0, 8)}`)
    node.children.forEach(collect)
  }
  collect(id)

  const copy = (nodeId: string): InsertNode => {
    const node = doc.nodes[nodeId]!
    if (node.type !== 'element' && node.type !== 'text') throw new Error('Unsupported element')
    const { parent: _, children, ...fields } = structuredClone(node)
    for (const [attribute, binding] of Object.entries(fields.attrs ?? {})) {
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
    const classes = node.classes.map((classId) => {
      const cls = doc.classes[classId]
      if (cls?.kind !== 'local' || cls.combo?.length || cls.locked) return classId
      if (!locals.has(classId)) {
        const next = `c-${crypto.randomUUID()}`
        locals.set(classId, next)
        operations.push({ type: 'class.create', id: next, local: true })
        for (const style of Object.values(doc.styles).filter((style) => style.class === classId))
          operations.push({ type: 'style.set', ...structuredClone(style), class: next })
      }
      return locals.get(classId)!
    })
    return {
      ...fields,
      id: `n-${crypto.randomUUID()}`,
      classes,
      children: children.map(copy),
    } as InsertNode
  }
  const node = copy(id)
  node.meta = {
    ...node.meta,
    label: `${doc.nodes[id]!.meta?.label ?? ('tag' in doc.nodes[id]! ? doc.nodes[id]!.tag : 'Element')} copy`,
  }
  operations.push({ type: 'node.create', ...insertionTarget(doc, '', id, 'after'), node })
  return { node, operations }
}
