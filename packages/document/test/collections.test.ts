import { fixtureDocument } from '@freeflow/schema'
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
  it('rejects an unknown key on an option choice instead of silently dropping it', () => {
    failing(
      [
        {
          type: 'collection.create',
          name: 'X',
          slug: 'x',
          fields: [
            { name: 'slug', label: 'Slug', type: 'slug' },
            {
              name: 'kind',
              label: 'Kind',
              type: 'option',
              options: [{ value: 'a', lable: 'A' } as unknown as { value: string }],
            },
          ],
          slugField: 'slug',
        },
      ],
      /invalid input: fields/,
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
