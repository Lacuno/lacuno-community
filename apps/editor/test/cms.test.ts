import { fixtureDocument } from '@lacuno/schema'
import { expect, it } from 'vitest'
import {
  duplicateEntry,
  entryError,
  entryFields,
  fieldName,
  listEntries,
  newCollection,
  slugify,
  uniqueSlug,
  uses,
  valueText,
} from '../src/cms.js'

const doc = fixtureDocument()
const posts = doc.collections['col-posts']!

it('makes slugs and field names from what people type', () => {
  expect(slugify('  Hello, Wörld – Straße! ')).toBe('hello-world-strasse')
  expect(fieldName('Cover image', [])).toBe('coverImage')
  expect(fieldName('2nd line', [])).toBe('field2ndLine')
  expect(fieldName('Title', ['title', 'title2'])).toBe('title3')
  expect(uniqueSlug(posts, doc.entries['col-posts']!, 'hello-world')).toBe('hello-world-2')
  expect(uniqueSlug(posts, doc.entries['col-posts']!, 'hello-world', 'e-1')).toBe('hello-world')
})

it('searches, sorts and describes entries', () => {
  const titles = (search: string, field?: string, direction: 'asc' | 'desc' = 'asc') =>
    listEntries(doc, posts, search, field ? { field, direction } : undefined).map(
      (entry) => entry.fields['f-title'],
    )
  expect(titles('')).toEqual(['Hello world', 'Second post', 'Third post'])
  expect(titles('SECOND')).toEqual(['Second post'])
  expect(titles('first post')).toEqual(['Hello world'])
  expect(titles('', 'f-date', 'desc')).toEqual(['Third post', 'Second post', 'Hello world'])
  expect(titles('', 'f-status')).toEqual(['Third post', 'Hello world', 'Second post'])
  const status = posts.fields.find((field) => field.id === 'f-status')!
  expect(valueText(doc, status, 'draft')).toBe('Draft')
  expect(valueText(doc, posts.fields[3]!, doc.entries['col-posts']![0]!.fields['f-body'])).toBe(
    'The first post.',
  )
})

it('checks an entry before saving and leaves empty fields unset', () => {
  expect(entryError(doc, posts, { 'f-slug': 'x' })).toBe('Enter Title.')
  expect(entryError(doc, posts, { 'f-title': 'T', 'f-slug': 'Not OK' })).toBe(
    'Slug may use lowercase letters, numbers and hyphens.',
  )
  expect(entryError(doc, posts, { 'f-title': 'T', 'f-slug': 'second-post' })).toBe(
    'Another entry already uses the slug second-post.',
  )
  expect(entryError(doc, posts, { 'f-title': 'T', 'f-slug': 'second-post' }, 'e-2')).toBe('')
  expect(entryFields(posts, { 'f-title': 'T', 'f-slug': 'x', 'f-date': '' })).toEqual({
    'f-title': 'T',
    'f-slug': 'x',
    'f-date': null,
    'f-body': null,
    'f-status': null,
  })
})

it('duplicates an entry with a free slug and names what uses things', () => {
  const copy = duplicateEntry(doc, posts, doc.entries['col-posts']![0]!)
  expect(copy).toMatchObject({
    type: 'entry.create',
    index: 1,
    fields: { 'f-title': 'Hello world copy', 'f-slug': 'hello-world-copy' },
  })
  expect(newCollection(doc, 'Posts')).toMatchObject({ slug: 'posts-2', slugField: 'slug' })
  expect(uses(doc, ['pages.p-post', 'entries.col-posts.1'])).toEqual([
    { label: `${doc.pages['p-post']!.name} page`, place: doc.pages['p-post']!.path },
    { label: 'Second post', place: 'Posts' },
  ])
})
