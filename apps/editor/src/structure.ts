import type { Operation } from '@lacuno/document'
import { isDescendant, subtreeIds } from '@lacuno/document/references'
import type { Document, ElementNode, Node, TextNode } from '@lacuno/schema'
import { localClassCopier } from './copyLocalClasses.js'

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

export const structures = ['section', 'container', 'stack', 'row', 'grid'] as const
export type Structure = (typeof structures)[number]
export const actions = ['link', 'button'] as const
export type Action = (typeof actions)[number]
/** Form parts that only go inside a form. */
export const formFields = [
  'text-field',
  'email-field',
  'textarea-field',
  'checkbox-field',
  'dropdown-field',
  'submit',
] as const
export type FormField = (typeof formFields)[number]
export type Preset =
  | 'heading'
  | 'paragraph'
  | 'span'
  | 'list'
  | 'image'
  | 'video'
  | 'embed'
  | Structure
  | Action
  | 'form'
  | FormField
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
  'ul',
  'ol',
  'li',
  'figure',
  'figcaption',
  'form',
  'label',
])

/** The id and each ancestor's id, up to the root. */
function* ancestors(doc: Document, id: string | null | undefined) {
  for (let current = id; current; current = doc.nodes[current]?.parent) yield current
}

const componentRoots = (doc: Document) =>
  new Set(Object.values(doc.components).map((component) => component.root))

/** Definitions stay protected unless explicitly opened in the shared-component editor. */
export function structureRestriction(doc: Document, id: string): string | undefined {
  const roots = componentRoots(doc)
  for (const current of ancestors(doc, id)) {
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

/** The nearest element with this tag, from the node itself up. */
const closest = (doc: Document, id: string, tag: string) =>
  [...ancestors(doc, id)].find((current) => {
    const node = doc.nodes[current]
    return node?.type === 'element' && node.tag === tag
  })

/** True when this node or any ancestor is locked. */
export const isLocked = (doc: Document, id: string) =>
  [...ancestors(doc, id)].some((current) => doc.nodes[current]?.meta?.locked)

/** True when this node sits inside a link: nested anchors are invalid HTML. */
export function hasAnchorParent(doc: Document, node: Node): boolean {
  for (const id of ancestors(doc, node.parent)) {
    const parent = doc.nodes[id]
    if (parent && 'tag' in parent && parent.tag === 'a') return true
  }
  return false
}

/** The page a node belongs to, so a new link can point at it. Empty inside a component. */
export function pageOf(doc: Document, id: string): string {
  const root = [...ancestors(doc, id)].at(-1)
  return Object.values(doc.pages).find((page) => page.root === root)?.id ?? ''
}

/** True when this node or any ancestor is the shared root of a component definition. */
export function isShared(doc: Document, id: string) {
  const roots = componentRoots(doc)
  return [...ancestors(doc, id)].some((current) => roots.has(current))
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
  ul: 'List',
  ol: 'List',
  li: 'Item',
  img: 'Image',
  video: 'Video',
  form: 'Form',
  label: 'Field',
  input: 'Input',
  textarea: 'Text area',
  select: 'Dropdown',
  option: 'Option',
  button: 'Button',
}

/** The name shown for an element in the layers, breadcrumbs, drag labels and the inspector. */
export function nodeLabel(node: Node) {
  if (node.meta?.label) return node.meta.label
  if (node.type === 'text' && node.tag === 'div') return 'Rich text'
  return 'tag' in node ? (tagLabels[node.tag] ?? node.tag) : node.type
}

/** Turns a boolean attribute on or off; autoplay also mutes, since browsers refuse it unmuted. */
export function toggleAttr(node: Node, name: string, on: boolean): Operation {
  const attrs = { ...node.attrs }
  for (const key of name === 'autoplay' && on ? [name, 'muted'] : [name]) {
    if (on) attrs[key] = { type: 'static', value: true }
    else delete attrs[key]
  }
  return { type: 'node.update', id: node.id, attrs }
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

/** What the element actions, their shortcuts and the layers' menu do to one element. */
export type NodeAction = 'duplicate' | 'delete' | 'up' | 'down'

/** Alt+↑ and Alt+↓ move the selected element one place among its siblings. */
export const moveShortcut = (
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'metaKey' | 'ctrlKey'>,
) =>
  event.altKey && !event.metaKey && !event.ctrlKey
    ? ({ ArrowUp: 'up', ArrowDown: 'down' } as const)[event.key as 'ArrowUp' | 'ArrowDown']
    : undefined

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

/** A dropdown's options, one text node each. */
export const optionNodes = (values: string[]): InsertNode[] =>
  values.map((value) => ({
    id: `n-${crypto.randomUUID()}`,
    type: 'text',
    tag: 'option',
    classes: [],
    text: { type: 'static', value },
  }))

/** Each field preset's control and label; the field's name is the label in lower case. */
const fieldPresets: Record<Exclude<FormField, 'submit'>, [string, string]> = {
  'text-field': ['text', 'Name'],
  'email-field': ['email', 'Email'],
  'textarea-field': ['textarea', 'Message'],
  'checkbox-field': ['checkbox', 'Subscribe to updates'],
  'dropdown-field': ['select', 'Topic'],
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
  if (preset === 'video')
    return {
      id: makeId(),
      type: 'element',
      tag: 'video',
      classes,
      attrs: {
        ...(assetId ? { src: { type: 'asset' as const, asset: assetId } } : {}),
        controls: { type: 'static', value: true },
        playsinline: { type: 'static', value: true },
      },
      meta: { label: 'Video' },
      children: [],
    }
  if (preset === 'embed')
    return { id: makeId(), type: 'embed', html: '', classes, meta: { label: 'Embed' } }
  // A label wraps its text and control, so no id and for pair is needed.
  const field = (kind: string, label: string, required = false): InsertNode => {
    const control: InsertNode = {
      id: makeId(),
      type: 'element',
      tag: kind === 'textarea' || kind === 'select' ? kind : 'input',
      classes: [],
      attrs: {
        name: { type: 'static', value: label.toLowerCase().replaceAll(' ', '-') },
        ...(kind === 'textarea'
          ? { rows: { type: 'static', value: 5 } }
          : kind === 'select'
            ? {}
            : { type: { type: 'static', value: kind } }),
        ...(required ? { required: { type: 'static', value: true } } : {}),
      },
      children: kind === 'select' ? optionNodes(['General', 'Support']) : [],
    }
    const caption = text('span', 'Label', label)
    return {
      id: makeId(),
      type: 'element',
      tag: 'label',
      classes: [],
      meta: { label },
      children: kind === 'checkbox' ? [control, caption] : [caption, control],
    }
  }
  const submit: InsertNode = {
    ...text('button', 'Submit', 'Send'),
    attrs: { type: { type: 'static', value: 'submit' } },
  }
  if (preset === 'form')
    return {
      id: makeId(),
      type: 'element',
      tag: 'form',
      classes,
      attrs: {
        'data-lacuno-form': { type: 'static', value: 'Contact form' },
        'data-success': { type: 'static', value: 'Thanks! Your message was sent.' },
      },
      meta: { label: 'Form' },
      children: [
        field('text', 'Name', true),
        field('email', 'Email', true),
        field('textarea', 'Message', true),
        submit,
      ],
    }
  if (preset === 'submit') return { ...submit, classes }
  if (preset in fieldPresets)
    return { ...field(...fieldPresets[preset as keyof typeof fieldPresets]), classes }
  if (preset === 'list')
    return {
      id: makeId(),
      type: 'element',
      tag: 'ul',
      classes,
      meta: { label: 'List' },
      children: ['First item', 'Second item', 'Third item'].map((value) =>
        text('li', 'Item', value),
      ),
    }
  // A page binding keeps the link pointing at the page after a path change.
  const href = pageId ? { attrs: { href: { type: 'page' as const, page: pageId } } } : {}
  if (preset === 'heading') return { ...text('h2', 'Heading', 'Your new heading'), classes }
  if (preset === 'paragraph')
    return { ...text('p', 'Paragraph', 'Write something worth sharing.'), classes }
  if (preset === 'span') return { ...text('span', 'Span', 'Span'), classes }
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

const defaults: Record<
  | Structure
  | 'image'
  | 'video'
  | 'list'
  | 'button'
  | 'link-wrapper'
  | 'form'
  | 'field'
  | 'control'
  | 'submit',
  Record<string, string>
> = {
  image: {
    display: 'block',
    'max-width': '100%',
    width: '100%',
    height: 'auto',
    'object-fit': 'cover',
    'object-position': '50% 50%',
  },
  video: { display: 'block', width: '100%', 'max-width': '100%', height: 'auto' },
  list: { 'padding-left': '24px', margin: '0' },
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
  form: { display: 'flex', 'flex-direction': 'column', gap: '16px' },
  // A control fills the line below its text; a checkbox sits beside it.
  field: { display: 'flex', 'flex-wrap': 'wrap', 'align-items': 'center', gap: '6px 8px' },
  control: {
    width: '100%',
    'box-sizing': 'border-box',
    padding: '10px 12px',
    border: '1px solid #d4d4d8',
    'border-radius': '8px',
    font: 'inherit',
  },
  submit: {
    'align-self': 'flex-start',
    padding: '12px 20px',
    border: 'none',
    'border-radius': '8px',
    background: '#6434d9',
    color: 'white',
    'font-family': 'inherit',
    'font-size': 'inherit',
    'font-weight': '600',
    cursor: 'pointer',
  },
}

/** The defaults of a form's parts; a checkbox keeps the browser's look. */
const formParts: Record<string, keyof typeof defaults> = {
  form: 'form',
  label: 'field',
  input: 'control',
  textarea: 'control',
  select: 'control',
  button: 'submit',
}
const formPart = (node: InsertNode) =>
  node.attrs?.type?.type === 'static' && node.attrs.type.value === 'checkbox'
    ? undefined
    : formParts['tag' in node ? node.tag : '']

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
  const style = (each: InsertNode, key = formPart(each)) => {
    if (key) {
      const id = `c-${crypto.randomUUID()}`
      each.classes.push(id)
      operations.push({ type: 'class.create', id, local: true })
      for (const [property, value] of Object.entries(defaults[key]))
        operations.push({
          type: 'style.set',
          class: id,
          breakpoint: 'base',
          state: 'none',
          property,
          value: { type: 'raw', value },
        })
    }
    for (const child of each.children ?? []) style(child)
  }
  style(node, preset in defaults ? (preset as keyof typeof defaults) : undefined)
  operations.push({ type: 'node.create', ...target, node })
  return { node, operations }
}

/** Where this wrapper goes around the selection, or why it cannot. */
export function wrapTarget(doc: Document, id: string, preset: Wrapper) {
  try {
    const target = insertionTarget(doc, '', id, 'after')
    const node = doc.nodes[id]!
    if (preset === 'link' && (('tag' in node && node.tag === 'a') || hasAnchorParent(doc, node)))
      return 'A link cannot be wrapped in another link.'
    return target
  } catch (error) {
    return (error as Error).message
  }
}

export function wrapSelection(doc: Document, id: string, preset: Wrapper) {
  const target = wrapTarget(doc, id, preset)
  if (typeof target === 'string') throw new Error(target)
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

export type DragItem = { preset: Preset; classId?: string; assetId?: string } | { id: string }

export function canContain(doc: Document, id: string) {
  const node = doc.nodes[id]
  return node?.type === 'element' && containers.has(node.tag)
}

/**
 * Validate a drop at `index` among the parent's current children (the dragged node included) and
 * resolve it to the index after removing the dragged node.
 */
export function dropTarget(
  doc: Document,
  root: string,
  item: DragItem,
  parent: string,
  index: number,
) {
  const belongs = (nodeId: string) => nodeId === root || isDescendant(doc, root, nodeId)
  if (!belongs(parent) || structureRestriction(doc, parent) || !canContain(doc, parent))
    throw new Error('Drop inside a container or beside an element.')
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
  const source = 'id' in item ? doc.nodes[item.id] : undefined
  const field =
    'preset' in item
      ? (formFields as readonly string[]).includes(item.preset)
      : source?.type === 'element' && source.tag === 'label'
  if (field && closest(doc, parent, 'label')) throw new Error('A field cannot hold another field.')
  if ('preset' in item && field && !closest(doc, parent, 'form'))
    throw new Error('Place form fields inside a form.')
  if ('preset' in item && item.preset === 'form' && closest(doc, parent, 'form'))
    throw new Error('A form cannot hold another form.')
  return { parent, index }
}

export function dropEdit(
  doc: Document,
  root: string,
  item: DragItem,
  parent: string,
  index: number,
) {
  const target = dropTarget(doc, root, item, parent, index)
  if ('preset' in item) {
    const edit = structureInsertion(
      item.preset,
      target,
      item.classId,
      false,
      item.assetId,
      pageOf(doc, root),
    )
    // A new field's name stays unique in its form: a second Email field is email-2.
    const form = closest(doc, target.parent, 'form')
    const taken = new Set(
      (form ? subtreeIds(doc, form) : []).map((id) => {
        const name = doc.nodes[id]!.attrs?.name
        return name?.type === 'static' ? name.value : ''
      }),
    )
    for (const child of edit.node.children ?? []) {
      const name = child.attrs?.name
      if (name?.type !== 'static') continue
      const base = name.value
      for (let n = 2; taken.has(name.value); n++) name.value = `${base}-${n}`
    }
    return edit
  }
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
  if (!['element', 'text', 'component', 'embed'].includes(node.type))
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
