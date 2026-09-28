import { checkReferences, type Document, fixtureDocument } from '@lacuno/schema'
import { describe, expect, it } from 'vitest'
import { plainImageResolver } from '../src/images.js'
import { render } from '../src/render.js'
import { enumerateRoutes } from '../src/routes.js'

const post = (doc: Document, index = 0) => doc.entries['col-posts']![index]!
const body = (doc: Document, page: string, entry = post(doc), listPage?: number) =>
  render(doc, doc.pages[page]!, doc.pages[page]!.collection ? entry : undefined, {
    resolveImage: plainImageResolver,
    ...(listPage ? { listPage } : {}),
  })

/** The fixture with a cover image, an author reference and a bound link on the post page. */
function blog(): Document {
  const doc = fixtureDocument()
  const posts = doc.collections['col-posts']!
  posts.fields.push(
    { id: 'f-cover', name: 'cover', label: 'Cover', type: 'image' },
    {
      id: 'f-related',
      name: 'related',
      label: 'Related',
      type: 'reference',
      reference: 'col-posts',
    },
  )
  Object.assign(post(doc).fields, { 'f-cover': 'a-hero', 'f-related': 'e-2' })
  const add = (id: string, node: Record<string, unknown>) => {
    doc.nodes[id] = { id, parent: 'n-post', children: [], classes: [], ...node } as never
    doc.nodes['n-post']!.children.push(id)
  }
  add('n-date', {
    type: 'text',
    tag: 'p',
    text: { type: 'field', field: 'f-date', format: 'long' },
  })
  add('n-cover', {
    type: 'element',
    tag: 'img',
    attrs: { src: { type: 'field', field: 'f-cover' }, alt: { type: 'field', field: 'f-title' } },
  })
  add('n-self', {
    type: 'text',
    tag: 'a',
    attrs: { href: { type: 'field', field: 'f-slug' } },
    text: { type: 'static', value: 'Permalink' },
  })
  add('n-next', {
    type: 'text',
    tag: 'a',
    attrs: { href: { type: 'field', field: 'f-related' } },
    text: { type: 'field', field: 'f-status' },
  })
  return doc
}

describe('field bindings', () => {
  it('reads dates in the page language, images as assets, slugs and references as entry pages', () => {
    const { body: html } = body(blog(), 'p-post')
    expect(html).toContain('<p>1 September 2026</p>')
    expect(html).toMatch(
      /<img[^>]*alt="Hello world"[^>]*src="\/assets\/0123456789abcdef[^"]*\.png"/,
    )
    expect(html).toContain('<a href="/blog/hello-world">Permalink</a>')
    // An option reads as its label.
    expect(html).toContain('<a href="/blog/second-post">published</a>')
  })

  it('fills the title, description and social image from entry fields', () => {
    const doc = blog()
    doc.pages['p-post']!.seo = {
      title: 'Blog',
      fields: { title: 'f-title', description: 'f-body', ogImage: 'f-cover' },
    }
    const { head } = body(doc, 'p-post')
    expect(head).toContain('<title>Hello world</title>')
    expect(head).toContain('<meta name="description" content="The first post.">')
    expect(head).toMatch(/og:image" content="\/assets\/0123456789abcdef/)
    expect(body(doc, 'p-post', post(doc, 1)).head).toContain('<title>Second post</title>')
  })

  it('checks that a field binding has a collection around it', () => {
    const doc = blog()
    doc.nodes['n-hero-title'] = {
      ...doc.nodes['n-hero-title']!,
      attrs: { title: { type: 'field', field: 'f-title' } },
    }
    doc.pages['p-home']!.seo = { fields: { title: 'f-title' } }
    expect(checkReferences(doc).map((issue) => issue.message)).toEqual([
      'field binding f-title outside a collection',
      'seo.fields.title needs a collection page',
    ])
  })
})

describe('paginated lists', () => {
  it('builds a page per limit of entries with links between them', () => {
    const doc = fixtureDocument()
    const list = doc.nodes['n-posts']!
    if (list.type !== 'collection-list') throw new Error('fixture list')
    list.query = { sort: [{ field: 'f-date', direction: 'asc' }], limit: 2, paginate: true }
    expect(enumerateRoutes(doc).filter((route) => route.page === 'p-home')).toEqual([
      { path: '/', page: 'p-home' },
      { path: '/page/2', page: 'p-home', listPage: 2 },
    ])
    const first = body(doc, 'p-home').body
    expect(first).toContain('Hello world')
    expect(first).not.toContain('Third post')
    expect(first).toContain('<span>Page 1 of 2</span><a href="/page/2" rel="next">Next →</a>')
    const second = body(doc, 'p-home', undefined, 2).body
    expect(second).toContain('Third post')
    expect(second).not.toContain('Hello world')
    expect(second).toContain('<a href="/" rel="prev">← Previous</a><span>Page 2 of 2</span></nav>')
    list.query.limit = undefined
    expect(checkReferences(doc).map((issue) => issue.message)).toEqual([
      'a paginated list needs a limit',
    ])
  })
})
