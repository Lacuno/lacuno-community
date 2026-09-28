import type { NodeLiteral, Operation } from '@lacuno/document'
import { subtreeIds } from '@lacuno/document/references'
import {
  type Binding,
  bindingScope,
  type CollectionSchema,
  type Document,
  type FieldDef,
  findEntry,
  type Node,
  nodeBindings,
  plainText,
  type RichText,
} from '@lacuno/schema'
import { entryTitle, newCollection, titleField } from './cms.js'
import { pageOf } from './structure.js'

/** The collection whose entry the node's bindings read, if any. */
export function scopeCollection(doc: Document, nodeId: string): CollectionSchema | undefined {
  const id = bindingScope(doc, nodeId)?.collection
  return id ? doc.collections[id] : undefined
}

/** The page that shows each entry of a collection, if there is one. */
export const collectionPage = (doc: Document, collection: string) =>
  Object.values(doc.pages).find((page) => page.collection === collection)

export type BindingSlot = 'text' | 'src' | 'alt' | 'href'

/** The fields a binding slot can show: text reads most, an image an image, a link an address. */
export function bindableFields(doc: Document, col: CollectionSchema, slot: BindingSlot) {
  return col.fields.filter((field) => {
    if (slot === 'src') return field.type === 'image'
    if (slot === 'alt') return field.type === 'text'
    if (slot === 'href')
      return (
        field.type === 'link' ||
        field.type === 'file' ||
        (field.type === 'slug' && !!collectionPage(doc, col.id)) ||
        (field.type === 'reference' && !!collectionPage(doc, field.reference))
      )
    return ['text', 'richtext', 'number', 'date', 'option', 'slug', 'link'].includes(field.type)
  })
}

type FieldBinding = Extract<Binding, { type: 'field' }>

/** The collection a field binding reads, and its chosen entry when it names one. */
export function bindingSource(doc: Document, nodeId: string, binding: FieldBinding) {
  if (binding.entry === undefined) return { collection: scopeCollection(doc, nodeId) }
  const found = findEntry(doc, binding.entry)
  return { collection: found?.collection, entry: found?.entry }
}

/** A field binding's label: the field, or for a chosen entry "Legal › Privacy › Body". */
export function bindingLabel(doc: Document, nodeId: string, binding: FieldBinding): string {
  const { collection, entry } = bindingSource(doc, nodeId, binding)
  const field = collection?.fields.find((item) => item.id === binding.field)?.label
  if (binding.entry === undefined) return field ?? 'Missing field'
  return collection && entry && field
    ? `${collection.name} › ${entryTitle(collection, entry)} › ${field}`
    : 'Missing entry'
}

/** The bound field's label for the chip on the selection, or '' when nothing is bound. */
export function boundFieldLabel(doc: Document, node: Node): string {
  const binding = nodeBindings(node).find((item) => item.type === 'field')
  return binding?.type === 'field' ? bindingLabel(doc, node.id, binding) : ''
}

/** The entry another element of the node's page reads, so binding the next field starts there. */
export function nearbyEntry(doc: Document, nodeId: string): string | undefined {
  const root = doc.pages[pageOf(doc, nodeId)]?.root
  return (root ? subtreeIds(doc, root) : [])
    .flatMap((id) => nodeBindings(doc.nodes[id]!))
    .flatMap((binding) => (binding.type === 'field' && binding.entry ? [binding.entry] : []))
    .at(-1)
}

export const fieldBinding = (field: string, format?: string, entry?: string): Binding => ({
  type: 'field',
  ...(entry ? { entry } : {}),
  field,
  ...(format ? { format: format as 'short' | 'medium' | 'long' | 'full' } : {}),
})

/**
 * A text back from a field: what the chosen entry, else the first entry, holds (rich text as it
 * is), else the field's label.
 */
export function unboundText(doc: Document, col: CollectionSchema, field: string, entry?: string) {
  const value = (
    entry ? doc.entries[col.id]?.find((item) => item.id === entry) : doc.entries[col.id]?.[0]
  )?.fields[field]
  if (col.fields.find((item) => item.id === field)?.type === 'richtext' && value)
    return structuredClone(value as RichText)
  const text =
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : value && typeof value === 'object'
        ? plainText(value)
        : ''
  const label = col.fields.find((item) => item.id === field)?.label ?? ''
  return {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text: text || label }] }],
  }
}

const styles = (id: string, values: Record<string, string>): Operation[] => [
  { type: 'class.create', id, local: true },
  ...Object.entries(values).map(
    ([property, value]): Operation => ({
      type: 'style.set',
      class: id,
      breakpoint: 'base',
      state: 'none',
      property,
      value: { type: 'raw', value },
    }),
  ),
]

/**
 * A collection list with a card per entry to design once: the image, title and first other text
 * of the entry, and a link to its page when the collection has one.
 */
export function listInsertion(
  doc: Document,
  col: CollectionSchema,
  target: { parent: string; index: number },
  linked = !!collectionPage(doc, col.id),
) {
  const id = () => `n-${crypto.randomUUID()}`
  const grid = `c-${crypto.randomUUID()}`
  const card = `c-${crypto.randomUUID()}`
  const title = titleField(col)
  const image = col.fields.find((field) => field.type === 'image')
  const summary = col.fields.find(
    (field) => field !== title && (field.type === 'text' || field.type === 'richtext'),
  )
  const slug = col.fields.find((field) => field.id === col.slugField)
  const text = (tag: string, label: string, field: FieldDef): NodeLiteral => ({
    id: id(),
    type: 'text',
    tag,
    classes: [],
    text: { type: 'field', field: field.id },
    meta: { label },
  })
  const node: NodeLiteral = {
    id: id(),
    type: 'collection-list',
    tag: 'div',
    collection: col.id,
    classes: [grid],
    meta: { label: `${col.name} list` },
    children: [
      {
        id: id(),
        type: 'element',
        tag: 'article',
        classes: [card],
        meta: { label: 'Item' },
        children: [
          ...(image
            ? [
                {
                  id: id(),
                  type: 'element',
                  tag: 'img',
                  classes: [],
                  attrs: {
                    src: { type: 'field', field: image.id },
                    ...(title ? { alt: { type: 'field', field: title.id } } : {}),
                  },
                  meta: { label: image.label },
                } satisfies NodeLiteral,
              ]
            : []),
          ...(title ? [text('h3', title.label, title)] : []),
          ...(summary
            ? [text(summary.type === 'richtext' ? 'div' : 'p', summary.label, summary)]
            : []),
          ...(slug && linked
            ? [
                {
                  id: id(),
                  type: 'text',
                  tag: 'a',
                  classes: [],
                  attrs: { href: { type: 'field', field: slug.id } },
                  text: { type: 'static', value: 'Read more' },
                  meta: { label: 'Link' },
                } satisfies NodeLiteral,
              ]
            : []),
        ],
      },
    ],
  }
  return {
    node,
    operations: [
      ...styles(grid, {
        display: 'grid',
        'grid-template-columns': 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: '24px',
      }),
      ...styles(card, { display: 'flex', 'flex-direction': 'column', gap: '8px' }),
      { type: 'node.create', ...target, node } satisfies Operation,
    ],
  }
}

/**
 * Points a list at another collection. Bindings inside follow a field of the same name, or of the
 * same kind for the title; the rest become written text again, so nothing reads a missing field.
 */
export function switchListCollection(doc: Document, listId: string, to: CollectionSchema) {
  const list = doc.nodes[listId]!
  const from = list.type === 'collection-list' ? doc.collections[list.collection] : undefined
  const operations: Operation[] = [
    { type: 'node.update', id: listId, collection: to.id, query: null },
  ]
  const match = (fieldId: string) => {
    const field = from?.fields.find((item) => item.id === fieldId)
    if (!field) return undefined
    if (field === (from && titleField(from))) return titleField(to)
    if (field.id === from?.slugField) return to.fields.find((item) => item.id === to.slugField)
    return to.fields.find((item) => item.name === field.name && item.type === field.type)
  }
  const visit = (id: string) => {
    const node = doc.nodes[id]
    if (!node) return
    // A nested list keeps its own scope.
    if (node.type === 'collection-list' && id !== listId) return
    if (id !== listId) {
      const attrs: Record<string, Binding> = {}
      for (const [name, binding] of Object.entries(node.attrs ?? {})) {
        const own = binding.type !== 'field' || binding.entry !== undefined
        const next = own ? undefined : match(binding.field)
        if (own) attrs[name] = binding
        else if (next) attrs[name] = { ...binding, field: next.id }
      }
      const changed = JSON.stringify(attrs) !== JSON.stringify(node.attrs ?? {})
      if (node.type === 'text' && node.text.type === 'field' && node.text.entry === undefined) {
        const next = match(node.text.field)
        operations.push({
          type: 'node.update',
          id,
          ...(changed ? { attrs } : {}),
          text: next
            ? { ...node.text, field: next.id }
            : from
              ? unboundText(doc, from, node.text.field)
              : { type: 'doc', content: [] },
        })
      } else if (changed) operations.push({ type: 'node.update', id, attrs })
    }
    for (const child of node.children) visit(child)
  }
  visit(listId)
  return operations
}

/** A path under `base` no page uses yet: `/blog`, else `/blog-2` and on. */
export function freePath(doc: Document, base: string) {
  const taken = new Set(Object.values(doc.pages).map((page) => page.path))
  const [head, ...rest] = base.split('/').filter(Boolean)
  const tail = rest.length ? `/${rest.join('/')}` : ''
  let path = base
  for (let n = 2; taken.has(path); n++) path = `/${head}-${n}${tail}`
  return path
}

/**
 * A page for every entry of a collection at /<collection>/[slug]: the title as its heading, the
 * image, and the rest of the text below, with the title as the page title in search results.
 */
export function collectionPageCreation(
  doc: Document,
  col: CollectionSchema,
  base = `/${col.slug}/[slug]`,
) {
  const id = `p-${crypto.randomUUID()}`
  const nodeId = () => `n-${crypto.randomUUID()}`
  const shell = `c-${crypto.randomUUID()}`
  const title = titleField(col)
  const bound = (tag: string, field: FieldDef, format?: string): NodeLiteral => ({
    id: nodeId(),
    type: 'text',
    tag,
    classes: [],
    text: fieldBinding(field.id, format),
    meta: { label: field.label },
  })
  const children = col.fields.flatMap((field): NodeLiteral[] => {
    if (field === title) return [bound('h1', field)]
    if (field.type === 'image')
      return [
        {
          id: nodeId(),
          type: 'element',
          tag: 'img',
          classes: [],
          attrs: {
            src: { type: 'field', field: field.id },
            ...(title ? { alt: { type: 'field', field: title.id } } : {}),
          },
          meta: { label: field.label },
        },
      ]
    if (field.type === 'richtext') return [bound('div', field)]
    if (field.type === 'text') return [bound('p', field)]
    if (field.type === 'date') return [bound('p', field, 'long')]
    return []
  })
  const path = freePath(doc, base)
  const operations: Operation[] = [
    ...styles(shell, {
      display: 'flex',
      'flex-direction': 'column',
      gap: '16px',
      width: '100%',
      'max-width': '760px',
      margin: '0 auto',
      padding: '64px 24px',
      'box-sizing': 'border-box',
    }),
    {
      type: 'page.create',
      id,
      name: `${col.name} page`,
      path,
      collection: col.id,
      ...(title ? { seo: { fields: { title: title.id } } } : {}),
      root: { id: nodeId(), type: 'element', tag: 'main', classes: [shell], children },
    },
  ]
  return { id, operations }
}

/** A page, not an entry page, that lists the collection's entries, if there is one. */
export const listPage = (doc: Document, collection: string) =>
  Object.values(doc.nodes)
    .filter((node) => node.type === 'collection-list' && node.collection === collection)
    .map((node) => doc.pages[pageOf(doc, node.id)])
    .find((page) => page && !page.collection)

/**
 * A page at /<collection> with the collection's name as its heading and a list of its entries,
 * each card linking to the entry's page.
 */
export function listPageCreation(
  doc: Document,
  col: CollectionSchema,
  name = col.name,
  path = freePath(doc, `/${col.slug}`),
) {
  const id = `p-${crypto.randomUUID()}`
  const rootId = `n-${crypto.randomUUID()}`
  const shell = `c-${crypto.randomUUID()}`
  const list = listInsertion(doc, col, { parent: rootId, index: 1 }, true)
  return {
    id,
    list: list.node,
    operations: [
      ...styles(shell, {
        display: 'flex',
        'flex-direction': 'column',
        gap: '32px',
        width: '100%',
        'max-width': '1120px',
        margin: '0 auto',
        padding: '64px 24px',
        'box-sizing': 'border-box',
      }),
      {
        type: 'page.create',
        id,
        name,
        path,
        root: {
          id: rootId,
          type: 'element',
          tag: 'main',
          classes: [shell],
          children: [
            {
              type: 'text',
              tag: 'h1',
              classes: [],
              text: { type: 'static', value: name },
              meta: { label: 'Heading' },
            },
          ],
        },
      },
      ...list.operations,
    ] satisfies Operation[],
  }
}

/**
 * A blog in one step: a Posts collection with a first post, a page per post and a /blog page
 * listing them newest first, ten to a page.
 */
export function blogStarter(doc: Document) {
  const create = newCollection(doc, 'Posts')
  if (create.type !== 'collection.create') throw new Error('unexpected operation')
  const field = (name: string, label: string, type: 'text' | 'date' | 'image' | 'richtext') => ({
    id: `f-${crypto.randomUUID()}`,
    name,
    label,
    type,
  })
  const summary = field('summary', 'Summary', 'text')
  const date = field('date', 'Date', 'date')
  const cover = field('cover', 'Cover image', 'image')
  const body = field('body', 'Body', 'richtext')
  create.fields.push(summary, date, cover, body)
  const [title, slug] = create.fields as [FieldDef, FieldDef]
  const col: CollectionSchema = {
    id: create.id!,
    name: create.name,
    slug: create.slug,
    fields: create.fields as FieldDef[],
    slugField: slug.id,
  }
  const draft: Document = {
    ...doc,
    collections: { ...doc.collections, [col.id]: col },
    entries: { ...doc.entries, [col.id]: [] },
  }
  const page = collectionPageCreation(draft, col, '/blog/[slug]')
  const list = listPageCreation(draft, col, 'Blog', freePath(doc, '/blog'))
  if (list.list.type === 'collection-list')
    list.list.query = { sort: [{ field: date.id, direction: 'desc' }], limit: 10, paginate: true }
  const today = new Date().toISOString().slice(0, 10)
  return {
    listPageId: list.id,
    operations: [
      create,
      {
        type: 'entry.create',
        collection: col.id,
        fields: {
          [title.id]: 'Hello world',
          [slug.id]: 'hello-world',
          [summary.id]: 'The first post of this blog. Edit it in the CMS.',
          [date.id]: today,
          [body.id]: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Write your first post here.' }],
              },
            ],
          },
        },
      },
      ...page.operations,
      ...list.operations,
    ] satisfies Operation[],
  }
}
