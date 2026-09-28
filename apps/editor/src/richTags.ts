import type { Operation } from '@lacuno/document'
import {
  type CssValue,
  type Document,
  type Node,
  RichTag,
  type State,
  styleKey,
} from '@lacuno/schema'
import { bindingSource } from './binding.js'
import { STATES } from './states.js'
import { pageOf } from './structure.js'

/** A tag inside the selected rich-text block: which one, and which of its kind was clicked. */
export type InnerTag = { tag: RichTag; index: number }

/** How the inspector names each tag, as in "H2 in Legal body" or "Links in Legal body". */
export const RICH_TAG_NAMES: Record<RichTag, string> = {
  h1: 'H1',
  h2: 'H2',
  h3: 'H3',
  h4: 'H4',
  h5: 'H5',
  h6: 'H6',
  p: 'Paragraphs',
  a: 'Links',
  strong: 'Bold text',
  em: 'Italic text',
  code: 'Inline code',
  pre: 'Code blocks',
  blockquote: 'Quotes',
  ul: 'Bulleted lists',
  ol: 'Numbered lists',
  li: 'List items',
  hr: 'Dividers',
  table: 'Table',
  tr: 'Table rows',
  th: 'Header cells',
  td: 'Cells',
}

/** A text whose content renders blocks: its own headings, lists or tables, or a rich-text field. */
export function isRichBlock(doc: Document, node: Node): boolean {
  if (node.type !== 'text') return false
  if (node.text.type === 'doc')
    return (
      !!node.text.content?.length &&
      !(node.text.content.length === 1 && node.text.content[0]?.type === 'paragraph')
    )
  if (node.text.type !== 'field') return false
  const field = node.text.field
  return (
    bindingSource(doc, node.id, node.text).collection?.fields.find((item) => item.id === field)
      ?.type === 'richtext'
  )
}

/**
 * The tag a click inside a rich-text block styles, and which of its kind in the block: the nearest
 * one on the list, where a list item or a cell stands for the paragraph it holds and the table for
 * its sections and gaps.
 */
export function richTagAt(block: Element, target: Element): InnerTag | undefined {
  for (let element: Element | null = target; element && element !== block; ) {
    const tag = element.tagName.toLowerCase()
    const parent: Element | null = element.parentElement
    const table = element.matches('.lc-table, thead, tbody, tr')
      ? element.closest('.lc-table')?.querySelector('table')
      : undefined
    if (table) return { tag: 'table', index: tagElements(block, 'table').indexOf(table) }
    const held =
      (tag === 'p' && parent?.matches('li, th, td')) || (tag === 'code' && parent?.matches('pre'))
    const rich = RichTag.safeParse(tag)
    if (!held && rich.success)
      return { tag: rich.data, index: tagElements(block, rich.data).indexOf(element) }
    element = parent
  }
  return undefined
}

/** The elements of a block a tag selection covers, in order. */
export const tagElements = (block: Element, tag: RichTag): Element[] => [
  ...block.querySelectorAll(tag),
]

/** The block's class its tag rules belong to: its first named class. */
export const richClass = (doc: Document, node: Node) =>
  node.classes.find((id) => doc.classes[id]?.kind === 'class' && !doc.classes[id]?.combo?.length)

/** The class's name, or the name of the style the first change creates: "About rich text". */
export function richClassName(doc: Document, node: Node): string {
  const id = richClass(doc, node)
  if (id) return doc.classes[id]?.name ?? id
  const base = `${doc.pages[pageOf(doc, node.id)]?.name ?? 'Shared'} rich text`
  const taken = new Set(Object.values(doc.classes).map((cls) => cls.name?.toLowerCase()))
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`
  return name
}

/** The states a tag can be in: links take focus and visits, other tags only the pointer. */
export const tagStates = (tag: RichTag) =>
  (Object.keys(STATES) as State[]).filter(
    (state) => tag === 'a' || !['focus', 'focus-visible', 'visited'].includes(state),
  )

/** The value a tag rule sets at this breakpoint and state. */
export const tagValue = (
  doc: Document,
  node: Node,
  tag: RichTag,
  property: string,
  breakpoint: string,
  state: State,
): CssValue | undefined => {
  const id = richClass(doc, node)
  return id
    ? doc.styles[styleKey({ class: id, tag, breakpoint, state, property })]?.value
    : undefined
}

/**
 * Operations that set or clear tag rules on the block's class. A block without a named class
 * gets a new preset on the first value, so other blocks can take the same look from the Preset
 * menu.
 */
export function tagStyleOperations(
  doc: Document,
  node: Node,
  tag: RichTag,
  changes: Record<string, CssValue | null>,
  breakpoint: string,
  state: State,
  makeId: () => string,
): Operation[] {
  const operations: Operation[] = []
  let id = richClass(doc, node)
  if (!id) {
    if (!Object.values(changes).some(Boolean)) return []
    id = makeId()
    operations.push(
      { type: 'class.create', id, name: richClassName(doc, node), preset: true },
      { type: 'node.update', id: node.id, classes: [...node.classes, id] },
    )
  }
  for (const [property, value] of Object.entries(changes)) {
    const coordinates = { class: id, tag, breakpoint, state, property }
    if (value) operations.push({ type: 'style.set', ...coordinates, value })
    else if (doc.styles[styleKey(coordinates)])
      operations.push({ type: 'style.clear', ...coordinates })
  }
  return operations
}
