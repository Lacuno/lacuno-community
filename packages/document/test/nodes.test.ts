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

describe('node.create', () => {
  it('creates a nested section in one operation and reports every id', () => {
    const { document, created, patches } = run([
      {
        type: 'node.create',
        parent: 'n-home',
        index: 1,
        node: {
          type: 'element',
          id: 'n-feat',
          tag: 'section',
          classes: ['c-container'],
          semantic: { role: 'feature-grid' },
          children: [
            {
              type: 'text',
              tag: 'h2',
              classes: ['c-heading'],
              text: {
                type: 'doc',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Features' }] }],
              },
            },
            {
              type: 'component',
              component: 'cmp-card',
              props: { title: { type: 'static', value: 'A' } },
            },
            { type: 'embed', html: '<hr>' },
          ],
        },
      },
    ])
    expect(document.nodes['n-home']!.children).toEqual(['n-hero', 'n-feat', 'n-posts'])
    const feat = document.nodes['n-feat']!
    expect(feat.parent).toBe('n-home')
    expect(feat.children).toHaveLength(3)
    expect(created[0]).toHaveLength(4)
    expect(created[0]![0]).toBe('n-feat')
    for (const id of feat.children) expect(document.nodes[id]!.parent).toBe('n-feat')
    expect(patches.at(-1)).toEqual({
      op: 'insert',
      path: ['nodes', 'n-home', 'children'],
      index: 1,
      value: 'n-feat',
    })
  })

  it('defaults the index to the end and validates references and parents', () => {
    const { document } = run([
      { type: 'node.create', parent: 'n-hero-inner', node: { type: 'element', tag: 'p' } },
    ])
    expect(document.nodes['n-hero-inner']!.children).toHaveLength(4)
    failing(
      [{ type: 'node.create', parent: 'nope', node: { type: 'element', tag: 'p' } }],
      /unknown node nope/,
    )
    failing(
      [{ type: 'node.create', parent: 'n-hero-title', node: { type: 'element', tag: 'p' } }],
      /cannot have children/,
    )
    failing(
      [{ type: 'node.create', parent: 'n-home', index: 9, node: { type: 'element', tag: 'p' } }],
      /index 9 out of range/,
    )
    failing(
      [
        {
          type: 'node.create',
          parent: 'n-home',
          node: { type: 'element', tag: 'p', classes: ['c-nope'] },
        },
      ],
      /unknown class c-nope/,
    )
    failing(
      [
        {
          type: 'node.create',
          parent: 'n-home',
          node: { type: 'component', component: 'cmp-nope' },
        },
      ],
      /unknown component cmp-nope/,
    )
    failing(
      [
        {
          type: 'node.create',
          parent: 'n-home',
          node: { type: 'collection-list', tag: 'ul', collection: 'col-nope' },
        },
      ],
      /unknown collection col-nope/,
    )
    failing(
      [{ type: 'node.create', parent: 'n-home', node: { type: 'element', tag: 'Bad' } }],
      /invalid input: node.tag/,
    )
  })

  it('refuses a class id that shadows an Object.prototype property name', () => {
    failing(
      [
        {
          type: 'node.create',
          parent: 'n-home',
          node: { type: 'element', tag: 'p', classes: ['toString'] },
        },
      ],
      /./,
    )
  })
})

describe('node.update', () => {
  it('updates classes, attrs, text and semantic and clears with null', () => {
    const { document } = run([
      {
        type: 'node.update',
        id: 'n-hero-cta',
        classes: ['c-button'],
        attrs: { href: { type: 'static', value: '/x' } },
      },
      {
        type: 'node.update',
        id: 'n-hero-title',
        text: { type: 'field', field: 'f-title' },
        semantic: null,
      },
      { type: 'node.update', id: 'n-post-card', props: { title: { type: 'static', value: 'T' } } },
      { type: 'node.update', id: 'n-posts', query: { limit: 2 } },
    ])
    expect(document.nodes['n-hero-cta']!.classes).toEqual(['c-button'])
    expect(document.nodes['n-hero-cta']!.attrs).toEqual({ href: { type: 'static', value: '/x' } })
    const title = document.nodes['n-hero-title']!
    expect(title.type === 'text' && title.text).toEqual({ type: 'field', field: 'f-title' })
    expect(title.semantic).toBeUndefined()
  })
  it("changes a tag and an embed's html", () => {
    const { document } = run([
      { type: 'node.update', id: 'n-hero', tag: 'article' },
      {
        type: 'node.create',
        parent: 'n-home',
        node: { type: 'embed', id: 'n-embed-new', html: '' },
      },
      { type: 'node.update', id: 'n-embed-new', html: '<b>Hi</b>' },
    ])
    expect(document.nodes['n-hero']).toMatchObject({ tag: 'article' })
    expect(document.nodes['n-embed-new']).toMatchObject({ html: '<b>Hi</b>' })
    failing(
      [
        { type: 'node.create', parent: 'n-home', node: { type: 'embed', id: 'n-e', html: '' } },
        { type: 'node.update', id: 'n-e', tag: 'div' },
      ],
      /tag applies to tagged nodes/,
    )
  })
  it('rejects fields that do not belong to the node type and unknown classes', () => {
    failing(
      [{ type: 'node.update', id: 'n-hero', text: { type: 'static', value: 'x' } }],
      /text applies to text nodes/,
    )
    failing(
      [{ type: 'node.update', id: 'n-hero', props: {} }],
      /props applies to component instances/,
    )
    failing([{ type: 'node.update', id: 'n-hero', query: {} }], /query applies to collection lists/)
    failing([{ type: 'node.update', id: 'n-hero', html: '<b>x</b>' }], /html applies to embed/)
    failing([{ type: 'node.update', id: 'n-hero', classes: ['c-nope'] }], /unknown class c-nope/)
    failing([{ type: 'node.update', id: 'nope' }], /unknown node nope/)
  })
  it('rejects an unknown key on query and on its nested filter and sort items', () => {
    failing(
      [
        {
          type: 'node.update',
          id: 'n-posts',
          query: { limt: 2 } as unknown as { limit: number },
        },
      ],
      /invalid input: query/,
    )
    failing(
      [
        {
          type: 'node.update',
          id: 'n-posts',
          query: {
            filter: [{ field: 'f-date', op: 'eq', valeu: 1 }],
          } as unknown as { filter: { field: string; op: 'eq'; value: unknown }[] },
        },
      ],
      /invalid input: query/,
    )
  })
})

describe('node.move', () => {
  it('reorders within a parent with a single move patch', () => {
    const { document, patches } = run([
      { type: 'node.move', id: 'n-hero-cta', parent: 'n-hero-inner', index: 0 },
    ])
    expect(document.nodes['n-hero-inner']!.children).toEqual([
      'n-hero-cta',
      'n-hero-title',
      'n-hero-image',
    ])
    expect(patches).toEqual([
      { op: 'move', path: ['nodes', 'n-hero-inner', 'children'], from: 2, to: 0 },
    ])
  })
  it('reparents with remove, insert and a parent update', () => {
    const { document } = run([{ type: 'node.move', id: 'n-hero-cta', parent: 'n-home', index: 0 }])
    expect(document.nodes['n-home']!.children).toEqual(['n-hero-cta', 'n-hero', 'n-posts'])
    expect(document.nodes['n-hero-inner']!.children).toEqual(['n-hero-title', 'n-hero-image'])
    expect(document.nodes['n-hero-cta']!.parent).toBe('n-home')
  })
  it('refuses roots, cycles and bad targets', () => {
    failing([{ type: 'node.move', id: 'n-home', parent: 'n-hero', index: 0 }], /root node/)
    failing(
      [{ type: 'node.move', id: 'n-hero', parent: 'n-hero-inner', index: 0 }],
      /inside its own subtree/,
    )
    failing(
      [{ type: 'node.move', id: 'n-hero', parent: 'n-hero', index: 0 }],
      /inside its own subtree/,
    )
    failing(
      [{ type: 'node.move', id: 'n-hero', parent: 'n-hero-title', index: 0 }],
      /cannot have children/,
    )
    failing(
      [{ type: 'node.move', id: 'n-hero-cta', parent: 'n-hero-inner', index: 3 }],
      /index 3 out of range/,
    )
  })
})

describe('node.delete', () => {
  it('removes the subtree and the parent link', () => {
    const { document, patches } = run([{ type: 'node.delete', id: 'n-hero' }])
    expect(document.nodes['n-home']!.children).toEqual(['n-posts'])
    for (const id of ['n-hero', 'n-hero-inner', 'n-hero-title', 'n-hero-image', 'n-hero-cta'])
      expect(document.nodes[id]).toBeUndefined()
    expect(patches[0]).toEqual({ op: 'remove', path: ['nodes', 'n-home', 'children'], index: 0 })
    expect(patches).toHaveLength(6)
  })
  it('refuses root nodes and unknown nodes', () => {
    failing([{ type: 'node.delete', id: 'n-home' }], /root node/)
    failing([{ type: 'node.delete', id: 'n-card' }], /root node/)
    failing([{ type: 'node.delete', id: 'nope' }], /unknown node nope/)
  })
})
