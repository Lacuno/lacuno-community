import { fixtureDocument } from '@lacuno/schema'
import { describe, expect, it } from 'vitest'
import { planBatch } from '../src/engine.js'
import { OperationError } from '../src/errors.js'
import { OPERATIONS_BY_TYPE, type Operation } from '../src/operations/index.js'

const run = (ops: Operation[], doc = fixtureDocument()) => planBatch(doc, ops, OPERATIONS_BY_TYPE)
const failing = (ops: Operation[], pattern: RegExp, doc = fixtureDocument()) => {
  try {
    planBatch(doc, ops, OPERATIONS_BY_TYPE)
    expect.unreachable()
  } catch (e) {
    expect(e).toBeInstanceOf(OperationError)
    expect((e as OperationError).message).toMatch(pattern)
    return e as OperationError
  }
}

describe('collections', () => {
  it('creates a collection from field literals and resolves the slug field by name', () => {
    const { document, created } = run([
      {
        type: 'collection.create',
        id: 'col-team',
        name: 'Team',
        slug: 'team',
        fields: [
          { id: 'f-name', name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'handle', label: 'Handle', type: 'slug', required: true },
          {
            name: 'role',
            label: 'Role',
            type: 'option',
            options: [{ value: 'dev' }, { value: 'ops', label: 'Ops' }],
          },
        ],
        slugField: 'handle',
      },
    ])
    const col = document.collections['col-team']!
    expect(col.fields.map((f) => f.name)).toEqual(['name', 'handle', 'role'])
    expect(col.slugField).toBe(col.fields[1]!.id)
    // Deviation from brief: ctx.id() is called for every field literal (supplied or minted),
    // matching context.ts's id() semantics (always pushes to `created`) and the precedent set by
    // components.test.ts / nodes.test.ts, where a supplied id is still reported as created.
    expect(created[0]).toEqual(['col-team', 'f-name', col.fields[1]!.id, col.fields[2]!.id])
    expect(document.entries['col-team']).toEqual([])
  })
  it('validates slugs, slug fields, field names and reference targets', () => {
    const fields = [{ name: 'slug', label: 'Slug', type: 'slug' as const }]
    failing(
      [{ type: 'collection.create', name: 'X', slug: 'posts', fields, slugField: 'slug' }],
      /slug posts is already used by col-posts/,
    )
    failing(
      [{ type: 'collection.create', name: 'X', slug: 'x', fields, slugField: 'nope' }],
      /no field named nope/,
    )
    failing(
      [
        {
          type: 'collection.create',
          name: 'X',
          slug: 'x',
          fields: [{ name: 't', label: 'T', type: 'text' }],
          slugField: 't',
        },
      ],
      /must have type slug/,
    )
    failing(
      [
        {
          type: 'collection.create',
          name: 'X',
          slug: 'x',
          fields: [...fields, { name: 'slug', label: 'S', type: 'text' }],
          slugField: 'slug',
        },
      ],
      /field name slug is used twice/,
    )
    failing(
      [
        {
          type: 'collection.create',
          name: 'X',
          slug: 'x',
          fields: [...fields, { name: 'r', label: 'R', type: 'reference', reference: 'col-nope' }],
          slugField: 'slug',
        },
      ],
      /unknown collection col-nope/,
    )
  })
  it('updates and refuses to delete a referenced collection, then deletes an unreferenced one with entries', () => {
    const e = failing([{ type: 'collection.delete', id: 'col-posts' }], /referenced/)
    expect(e.referencedBy).toEqual(['nodes.n-posts', 'pages.p-post'])
    const { document } = run([
      { type: 'collection.update', id: 'col-posts', name: 'Articles', slug: 'articles' },
      { type: 'page.delete', id: 'p-post' },
      { type: 'node.delete', id: 'n-posts' },
      { type: 'collection.delete', id: 'col-posts' },
    ])
    expect(document.collections['col-posts']).toBeUndefined()
    expect(document.entries['col-posts']).toBeUndefined()
  })
})

describe('fields', () => {
  it('adds, updates and removes fields, dropping removed values from entries', () => {
    const { document } = run([
      {
        type: 'field.add',
        collection: 'col-posts',
        field: { id: 'f-tags', name: 'tags', label: 'Tags', type: 'text' },
        index: 1,
      },
      {
        type: 'field.update',
        collection: 'col-posts',
        id: 'f-status',
        label: 'State',
        options: [{ value: 'draft' }, { value: 'published' }, { value: 'archived' }],
      },
      { type: 'entry.update', collection: 'col-posts', id: 'e-1', fields: { 'f-tags': 'a' } },
      { type: 'field.remove', collection: 'col-posts', id: 'f-tags' },
    ])
    const col = document.collections['col-posts']!
    expect(col.fields.map((f) => f.name)).toEqual(['title', 'slug', 'date', 'body', 'status'])
    expect(col.fields.find((f) => f.id === 'f-status')).toMatchObject({ label: 'State' })
    expect(document.entries['col-posts']![0]!.fields['f-tags']).toBeUndefined()
  })
  it('refuses removing the slug field, a bound field, or type-mismatched updates', () => {
    failing([{ type: 'field.remove', collection: 'col-posts', id: 'f-slug' }], /slug field/)
    const e = failing(
      [{ type: 'field.remove', collection: 'col-posts', id: 'f-title' }],
      /referenced/,
    )
    expect(e.referencedBy).toEqual(['nodes.n-post-card', 'nodes.n-post-title'])
    const seo = failing(
      [
        { type: 'page.update', id: 'p-post', seo: { fields: { description: 'f-date' } } },
        { type: 'field.remove', collection: 'col-posts', id: 'f-date' },
      ],
      /referenced/,
    )
    expect(seo.referencedBy).toEqual(['nodes.n-posts', 'pages.p-post'])
    failing(
      [{ type: 'field.update', collection: 'col-posts', id: 'f-title', options: [{ value: 'x' }] }],
      /options applies to option fields/,
    )
    failing(
      [{ type: 'field.update', collection: 'col-posts', id: 'f-title', reference: 'col-posts' }],
      /reference applies to reference fields/,
    )
    failing(
      [
        {
          type: 'field.add',
          collection: 'col-posts',
          field: { name: 'title', label: 'T', type: 'text' },
        },
      ],
      /field name title is already used/,
    )
    failing(
      [
        {
          type: 'field.add',
          collection: 'col-nope',
          field: { name: 't', label: 'T', type: 'text' },
        },
      ],
      /unknown collection col-nope/,
    )
  })
})

describe('entries', () => {
  it('rejects unknown fields even when their value is null on create', () => {
    failing(
      [
        {
          type: 'entry.create',
          collection: 'col-posts',
          fields: { 'f-title': 'Four', 'f-slug': 'four', 'f-nope': null },
        },
      ],
      /unknown field f-nope/,
    )
  })

  it('omits a known optional null field on create', () => {
    const { document, created } = run([
      {
        type: 'entry.create',
        collection: 'col-posts',
        fields: { 'f-title': 'Four', 'f-slug': 'four', 'f-date': null },
      },
    ])
    const entry = document.entries['col-posts']!.find((e) => e.id === created[0]![0])!
    expect(entry.fields).not.toHaveProperty('f-date')
  })

  it('creates, updates, moves and deletes entries', () => {
    const { document, created } = run([
      {
        type: 'entry.create',
        collection: 'col-posts',
        fields: { 'f-title': 'Four', 'f-slug': 'four', 'f-status': 'draft' },
        index: 0,
      },
      {
        type: 'entry.update',
        collection: 'col-posts',
        id: 'e-1',
        fields: { 'f-date': null, 'f-status': 'draft' },
      },
      { type: 'entry.move', collection: 'col-posts', id: 'e-3', index: 0 },
      { type: 'entry.delete', collection: 'col-posts', id: 'e-2' },
    ])
    const entries = document.entries['col-posts']!
    expect(entries.map((e) => e.id)).toEqual(['e-3', created[0]![0], 'e-1'])
    expect(entries[2]!.fields).toEqual({
      'f-title': 'Hello world',
      'f-slug': 'hello-world',
      'f-status': 'draft',
      'f-body': expect.anything(),
    })
  })
  it('validates required fields, unknown fields, slugs and option values', () => {
    failing(
      [{ type: 'entry.create', collection: 'col-posts', fields: { 'f-slug': 'x' } }],
      /missing required field title/,
    )
    failing(
      [
        {
          type: 'entry.create',
          collection: 'col-posts',
          fields: { 'f-title': 'T', 'f-slug': 'x', 'f-nope': 1 },
        },
      ],
      /unknown field f-nope/,
    )
    failing(
      [
        {
          type: 'entry.create',
          collection: 'col-posts',
          fields: { 'f-title': 'T', 'f-slug': 'hello-world' },
        },
      ],
      /slug hello-world is already used by e-1/,
    )
    failing(
      [
        {
          type: 'entry.create',
          collection: 'col-posts',
          fields: { 'f-title': 'T', 'f-slug': 'Bad Slug' },
        },
      ],
      /slug must be lower-case/,
    )
    failing(
      [
        {
          type: 'entry.create',
          collection: 'col-posts',
          fields: { 'f-title': 'T', 'f-slug': 'ok', 'f-status': 'nope' },
        },
      ],
      /"nope" is not an option of field status/,
    )
    failing(
      [{ type: 'entry.update', collection: 'col-posts', id: 'e-1', fields: { 'f-title': null } }],
      /missing required field title/,
    )
    failing(
      [
        {
          type: 'entry.create',
          collection: 'col-posts',
          fields: { 'f-title': null, 'f-slug': 'zzz' },
        },
      ],
      /missing required field title/,
    )
    failing(
      [{ type: 'entry.move', collection: 'col-posts', id: 'e-1', index: 3 }],
      /index 3 out of range/,
    )
    failing([{ type: 'entry.delete', collection: 'col-posts', id: 'nope' }], /unknown entry nope/)
  })
})

describe('editing collections by hand', () => {
  const author = (fields: Record<string, unknown> = {}): Operation[] => [
    {
      type: 'collection.create',
      id: 'col-authors',
      name: 'Authors',
      slug: 'authors',
      fields: [
        { id: 'f-name', name: 'name', label: 'Name', type: 'text', required: true },
        { id: 'f-handle', name: 'handle', label: 'Handle', type: 'slug', required: true },
        { id: 'f-alias', name: 'alias', label: 'Alias', type: 'slug' },
      ],
      slugField: 'handle',
    },
    {
      type: 'entry.create',
      collection: 'col-authors',
      id: 'e-ada',
      fields: { 'f-name': 'Ada', 'f-handle': 'ada', ...fields },
    },
    {
      type: 'field.add',
      collection: 'col-posts',
      field: {
        id: 'f-author',
        name: 'author',
        label: 'Author',
        type: 'reference',
        reference: 'col-authors',
      },
    },
  ]

  it('renames and moves fields, keeping bindings on the field id', () => {
    const { document } = run([
      { type: 'field.update', collection: 'col-posts', id: 'f-title', name: 'headline' },
      { type: 'field.move', collection: 'col-posts', id: 'f-status', index: 0 },
    ])
    const col = document.collections['col-posts']!
    expect(col.fields.map((f) => f.name)).toEqual(['status', 'headline', 'slug', 'date', 'body'])
    failing(
      [{ type: 'field.update', collection: 'col-posts', id: 'f-title', name: 'slug' }],
      /field name slug is already used/,
    )
    failing(
      [{ type: 'field.move', collection: 'col-posts', id: 'f-title', index: 5 }],
      /index 5 out of range/,
    )
  })

  it('switches the slug field only when every entry has an address in it', () => {
    failing(
      [...author(), { type: 'collection.update', id: 'col-authors', slugField: 'f-alias' }],
      /slug must be lower-case/,
    )
    failing(
      [...author(), { type: 'collection.update', id: 'col-authors', slugField: 'f-name' }],
      /must have type slug/,
    )
    const { document } = run([
      ...author({ 'f-alias': 'countess' }),
      { type: 'collection.update', id: 'col-authors', slugField: 'f-alias' },
    ])
    expect(document.collections['col-authors']!.slugField).toBe('f-alias')
  })

  it('checks values by field type', () => {
    const post = (fields: Record<string, unknown>): Operation => ({
      type: 'entry.create',
      collection: 'col-posts',
      fields: { 'f-title': 'T', 'f-slug': 'typed', ...fields },
    })
    failing([post({ 'f-date': 'next tuesday' })], /field date expects a date/)
    failing([post({ 'f-body': 'plain' })], /field body expects rich text/)
    failing([post({ 'f-title': 3 })], /field title expects a string/)
    failing(
      [
        {
          type: 'field.add',
          collection: 'col-posts',
          field: { id: 'f-cover', name: 'cover', label: 'Cover', type: 'image' },
        },
        post({ 'f-cover': 'a-clip' }),
      ],
      /field cover expects the id of an image asset/,
    )
    failing(
      [...author(), post({ 'f-author': 'e-1' })],
      /field author expects an entry id of col-authors/,
    )
    const { document } = run([
      ...author(),
      {
        type: 'field.add',
        collection: 'col-posts',
        field: { id: 'f-cover', name: 'cover', label: 'Cover', type: 'image' },
      },
      post({ 'f-date': '2026-09-28', 'f-author': 'e-ada', 'f-cover': 'a-hero' }),
    ])
    expect(document.entries['col-posts']!.at(-1)!.fields['f-author']).toBe('e-ada')
  })

  it('refuses changes existing entries would break', () => {
    failing(
      [{ type: 'field.update', collection: 'col-posts', id: 'f-body', required: true }],
      /missing required field body in entry e-2/,
    )
    failing(
      [
        {
          type: 'field.update',
          collection: 'col-posts',
          id: 'f-status',
          options: [{ value: 'published' }],
        },
      ],
      /"draft" is not an option of field status in entry e-3/,
    )
    failing(
      [
        {
          type: 'field.add',
          collection: 'col-posts',
          field: { name: 'teaser', label: 'Teaser', type: 'text', required: true },
        },
      ],
      /missing required field teaser in entry e-1/,
    )
  })

  it('refuses deleting an entry another entry references, and an asset an entry uses', () => {
    const doc = run([
      ...author(),
      { type: 'entry.update', collection: 'col-posts', id: 'e-2', fields: { 'f-author': 'e-ada' } },
      {
        type: 'field.add',
        collection: 'col-posts',
        field: { id: 'f-cover', name: 'cover', label: 'Cover', type: 'image' },
      },
      { type: 'entry.update', collection: 'col-posts', id: 'e-1', fields: { 'f-cover': 'a-hero' } },
    ]).document
    const e = failing(
      [{ type: 'entry.delete', collection: 'col-authors', id: 'e-ada' }],
      /referenced/,
      doc,
    )
    expect(e.referencedBy).toEqual(['entries.col-posts.1'])
    const asset = failing([{ type: 'asset.delete', id: 'a-hero' }], /referenced/, doc)
    expect(asset.referencedBy).toContain('entries.col-posts.0')
    run(
      [
        { type: 'entry.update', collection: 'col-posts', id: 'e-2', fields: { 'f-author': null } },
        { type: 'entry.delete', collection: 'col-authors', id: 'e-ada' },
      ],
      doc,
    )
  })
})
