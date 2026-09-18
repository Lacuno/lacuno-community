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
