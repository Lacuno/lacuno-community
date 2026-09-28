import { DocumentStore, type Operation } from '@lacuno/document'
import { createEmptyDocument, type Document, fixtureDocument } from '@lacuno/schema'
import { expect, it } from 'vitest'
import {
  bindableFields,
  blogStarter,
  boundFieldLabel,
  collectionPageCreation,
  listInsertion,
  nearbyEntry,
  scopeCollection,
  switchListCollection,
  unboundText,
} from '../src/binding.js'

const apply = async (doc: Document, operations: Operation[]) => {
  const store = DocumentStore.inMemory(doc)
  await store.apply({ expectedRevision: store.revision, operations })
  return store.read().document
}

it('knows which collection a node reads and which fields each slot can show', () => {
  const doc = fixtureDocument()
  const posts = doc.collections['col-posts']!
  expect(scopeCollection(doc, 'n-post-title')?.id).toBe('col-posts')
  expect(scopeCollection(doc, 'n-post-card')?.id).toBe('col-posts')
  expect(scopeCollection(doc, 'n-hero-title')).toBeUndefined()
  expect(bindableFields(doc, posts, 'text').map((field) => field.name)).toEqual([
    'title',
    'slug',
    'date',
    'body',
    'status',
  ])
  // A slug links to the entry's own page, which the fixture has.
  expect(bindableFields(doc, posts, 'href').map((field) => field.name)).toEqual(['slug'])
  expect(bindableFields(doc, posts, 'src')).toEqual([])
})

it('inserts a list whose card binds the title and links to the entry page', async () => {
  const doc = fixtureDocument()
  const { node, operations } = listInsertion(doc, doc.collections['col-posts']!, {
    parent: 'n-home',
    index: 0,
  })
  const next = await apply(doc, operations)
  const card = next.nodes[next.nodes[node.id!]!.children[0]!]!
  const texts = card.children.map((id) => next.nodes[id]!)
  expect(texts.map((item) => ('tag' in item ? item.tag : ''))).toEqual(['h3', 'div', 'a'])
  expect(texts[0]).toMatchObject({ text: { type: 'field', field: 'f-title' } })
  expect(texts[2]).toMatchObject({ attrs: { href: { type: 'field', field: 'f-slug' } } })
})

it('moves bindings to the new collection when a list switches, or writes them out', async () => {
  const doc = fixtureDocument()
  const { node, operations } = listInsertion(doc, doc.collections['col-posts']!, {
    parent: 'n-home',
    index: 0,
  })
  let next = await apply(doc, [
    ...operations,
    {
      type: 'collection.create',
      id: 'col-team',
      name: 'Team',
      slug: 'team',
      fields: [
        { id: 'f-name', name: 'name', label: 'Name', type: 'text', required: true },
        { id: 'f-handle', name: 'handle', label: 'Handle', type: 'slug', required: true },
      ],
      slugField: 'handle',
    },
  ])
  next = await apply(next, switchListCollection(next, node.id!, next.collections['col-team']!))
  const card = next.nodes[next.nodes[node.id!]!.children[0]!]!
  const [title, body, link] = card.children.map((id) => next.nodes[id]!)
  expect(title).toMatchObject({ text: { type: 'field', field: 'f-name' } })
  // The body has no match and keeps what the first post said.
  expect(body).toMatchObject({ text: { type: 'doc' } })
  expect(JSON.stringify(body)).toContain('The first post.')
  expect(link).toMatchObject({ attrs: { href: { type: 'field', field: 'f-handle' } } })
})

it('creates a page per entry and a whole blog in one step', async () => {
  const doc = fixtureDocument()
  const page = collectionPageCreation(doc, doc.collections['col-posts']!)
  const withPage = await apply(doc, page.operations)
  expect(withPage.pages[page.id]).toMatchObject({
    path: '/posts/[slug]',
    collection: 'col-posts',
    seo: { fields: { title: 'f-title' } },
  })
  const empty = createEmptyDocument()
  const starter = blogStarter(empty)
  const blog = await apply(empty, starter.operations)
  const posts = Object.values(blog.collections)[0]!
  expect(posts.fields.map((field) => field.name)).toEqual([
    'title',
    'slug',
    'summary',
    'date',
    'cover',
    'body',
  ])
  expect(blog.entries[posts.id]).toHaveLength(1)
  expect(Object.values(blog.pages).map((item) => item.path)).toEqual(
    expect.arrayContaining(['/blog', '/blog/[slug]']),
  )
  const list = Object.values(blog.nodes).find((node) => node.type === 'collection-list')
  expect(list).toMatchObject({ query: { limit: 10, paginate: true } })
})

it('names a chosen entry on the chip, starts the next binding there and unbinds to its content', async () => {
  const doc = await apply(fixtureDocument(), [
    {
      type: 'node.create',
      parent: 'n-home',
      node: {
        type: 'text',
        id: 'n-legal',
        tag: 'div',
        text: { type: 'field', entry: 'e-1', field: 'f-body' },
      },
    },
  ])
  expect(boundFieldLabel(doc, doc.nodes['n-legal']!)).toBe('Posts › Hello world › Body')
  expect(boundFieldLabel(doc, doc.nodes['n-post-title']!)).toBe('Title')
  expect(nearbyEntry(doc, 'n-hero-title')).toBe('e-1')
  expect(nearbyEntry(doc, 'n-post-title')).toBeUndefined()
  const posts = doc.collections['col-posts']!
  // Rich text comes back whole; other values as a paragraph.
  expect(unboundText(doc, posts, 'f-body', 'e-1')).toEqual(
    doc.entries['col-posts']![0]!.fields['f-body'],
  )
  expect(unboundText(doc, posts, 'f-title', 'e-2').content).toEqual([
    { type: 'paragraph', content: [{ type: 'text', text: 'Second post' }] },
  ])
})
