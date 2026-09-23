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

describe('pages', () => {
  it('creates a page with a default main root, then a page with a custom root', () => {
    const { document, created } = run([
      { type: 'page.create', id: 'p-about', name: 'About', path: '/about' },
      {
        type: 'page.create',
        name: 'Contact',
        path: '/contact',
        seo: { title: 'Contact us' },
        root: {
          type: 'element',
          tag: 'main',
          classes: ['c-page'],
          children: [{ type: 'element', tag: 'h1' }],
        },
      },
    ])
    const about = document.pages['p-about']!
    const root = document.nodes[about.root]!
    expect(root).toMatchObject({
      type: 'element',
      tag: 'main',
      parent: null,
      children: [],
      classes: [],
    })
    expect(created[0]).toEqual(['p-about', about.root])
    expect(created[1]).toHaveLength(3)
    const contact = Object.values(document.pages).find((p) => p.path === '/contact')!
    expect(document.nodes[contact.root]!.children).toHaveLength(1)
  })
  it('refuses duplicate paths, unknown folders and collections, and collection pages without a param', () => {
    failing([{ type: 'page.create', name: 'X', path: '/' }], /path \/ is already used by p-home/)
    failing([{ type: 'page.create', name: 'X', path: '/x', folder: 'nope' }], /unknown folder nope/)
    failing(
      [{ type: 'page.create', name: 'X', path: '/x', collection: 'col-nope' }],
      /unknown collection col-nope/,
    )
    failing(
      [{ type: 'page.create', name: 'X', path: '/x', collection: 'col-posts' }],
      /needs a \[param\]/,
    )
    failing([{ type: 'page.create', name: 'X', path: 'no-slash' }], /invalid input: path/)
  })
  it('updates fields, clears optional ones, and deletes with the subtree', () => {
    const { document } = run([
      { type: 'page.update', id: 'p-home', name: 'Start', seo: null, headCode: '<meta>' },
      { type: 'page.delete', id: 'p-post' },
    ])
    expect(document.pages['p-home']).toMatchObject({ name: 'Start', headCode: '<meta>' })
    expect(document.pages['p-home']!.seo).toBeUndefined()
    expect(document.pages['p-post']).toBeUndefined()
    expect(document.nodes['n-post']).toBeUndefined()
    expect(document.nodes['n-post-title']).toBeUndefined()
    failing([{ type: 'page.update', id: 'p-post', path: '/' }], /already used by p-home/)
    failing([{ type: 'page.update', id: 'nope', name: 'x' }], /unknown page nope/)
    failing([{ type: 'page.delete', id: 'nope' }], /unknown page nope/)
  })
  it('sets a page language on create and update, clears it, and refuses a malformed one', () => {
    const { document } = run([
      { type: 'page.create', id: 'p-about', name: 'About', path: '/about', lang: 'de-AT' },
      { type: 'page.update', id: 'p-home', lang: 'en' },
      { type: 'page.update', id: 'p-post', lang: null },
    ])
    expect(document.pages['p-about']!.lang).toBe('de-AT')
    expect(document.pages['p-home']!.lang).toBe('en')
    expect(document.pages['p-post']).not.toHaveProperty('lang')
    failing([{ type: 'page.update', id: 'p-home', lang: 'English' }], /invalid input: lang/)
  })
  it('refuses deleting a page a node binding points at, and allows it once the node is gone', () => {
    const doc = run([
      {
        type: 'node.create',
        parent: 'n-hero-inner',
        node: {
          type: 'element',
          tag: 'a',
          id: 'n-link',
          attrs: { href: { type: 'page', page: 'p-not-found' } },
        },
      },
    ]).document
    const e = failing(
      [{ type: 'page.delete', id: 'p-not-found' }],
      /page p-not-found is referenced/,
      doc,
    )
    expect(e.referencedBy).toEqual(['nodes.n-link'])
    const after = run(
      [
        { type: 'node.delete', id: 'n-link' },
        { type: 'page.delete', id: 'p-not-found' },
      ],
      doc,
    )
    expect(after.document.pages['p-not-found']).toBeUndefined()
  })

  it('refuses deleting a page a rich-text link in a text node or an entry points at', () => {
    const doc = fixtureDocument()
    const link = {
      type: 'doc' as const,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Lost?',
              marks: [{ type: 'link', attrs: { pageId: 'p-not-found' } }],
            },
          ],
        },
      ],
    }
    doc.nodes['n-link'] = {
      id: 'n-link',
      type: 'text',
      tag: 'p',
      parent: 'n-hero-inner',
      children: [],
      classes: [],
      text: link,
    }
    doc.nodes['n-hero-inner']!.children.push('n-link')
    doc.entries['col-posts']![0]!.fields['f-body'] = link
    const e = failing([{ type: 'page.delete', id: 'p-not-found' }], /is referenced/, doc)
    expect(e.referencedBy).toEqual(['entries.col-posts.0', 'nodes.n-link'])
  })

  it('deletes a page that only links to itself', () => {
    const root = fixtureDocument().pages['p-not-found']!.root
    const doc = run([
      {
        type: 'node.create',
        parent: root,
        node: {
          type: 'element',
          tag: 'a',
          id: 'n-self',
          attrs: { href: { type: 'page', page: 'p-not-found' } },
        },
      },
    ]).document
    const after = run([{ type: 'page.delete', id: 'p-not-found' }], doc)
    expect(after.document.pages['p-not-found']).toBeUndefined()
    expect(after.document.nodes['n-self']).toBeUndefined()
  })
})

describe('folders', () => {
  it('creates, nests, moves and deletes folders', () => {
    const { document } = run([
      { type: 'folder.create', id: 'fo-a', name: 'A' },
      { type: 'folder.create', id: 'fo-b', name: 'B', parent: 'fo-a' },
      { type: 'page.update', id: 'p-home', folder: 'fo-b' },
      { type: 'folder.update', id: 'fo-b', name: 'B2', parent: null },
      { type: 'folder.delete', id: 'fo-a' },
    ])
    expect(document.folders).toEqual({ 'fo-b': { id: 'fo-b', name: 'B2' } })
    expect(document.pages['p-home']!.folder).toBe('fo-b')
  })
  it('refuses cycles, unknown parents, and deleting folders in use', () => {
    const doc = run([
      { type: 'folder.create', id: 'fo-a', name: 'A' },
      { type: 'folder.create', id: 'fo-b', name: 'B', parent: 'fo-a' },
      { type: 'page.update', id: 'p-home', folder: 'fo-b' },
    ]).document
    failing([{ type: 'folder.update', id: 'fo-a', parent: 'fo-b' }], /inside itself/, doc)
    failing([{ type: 'folder.update', id: 'fo-a', parent: 'fo-a' }], /inside itself/, doc)
    failing([{ type: 'folder.create', name: 'C', parent: 'nope' }], /unknown folder nope/, doc)
    const e = failing([{ type: 'folder.delete', id: 'fo-b' }], /referenced/, doc)
    expect(e.referencedBy).toEqual(['pages.p-home'])
    const e2 = failing([{ type: 'folder.delete', id: 'fo-a' }], /referenced/, doc)
    expect(e2.referencedBy).toEqual(['folders.fo-b'])
  })
})
