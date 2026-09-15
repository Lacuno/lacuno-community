import { fixtureDocument, type TextNode } from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import { RenderError } from '../src/errors.js'
import { plainImageResolver } from '../src/images.js'
import { assembleDocument, render } from '../src/render.js'

const ctx = { resolveImage: plainImageResolver }

describe('render', () => {
  it('renders the fixture home page', () => {
    const doc = fixtureDocument()
    const result = render(doc, doc.pages['p-home']!, undefined, ctx)
    expect(result.htmlAttrs).toEqual({ lang: 'en' })
    expect(result.warnings).toEqual([])
    expect(result.body).toContain('<main class="page">')
    expect(result.body).toContain(
      '<h1 class="heading ff-l-hero-title">Design it. Publish it. Own it.</h1>',
    )
    expect(result.body).toContain('<a class="button primary" href="/blog">Read the blog</a>')
    expect(result.body).toContain('<h3>Third post</h3>')
    expect(assembleDocument(result)).toMatchSnapshot()
  })

  it('renders a collection page for an entry with the entry path in the head', () => {
    const doc = fixtureDocument()
    doc.site.url = 'https://example.com'
    const entry = doc.entries['col-posts']![0]!
    const result = render(doc, doc.pages['p-post']!, entry, ctx)
    expect(result.body).toContain('<h1 class="heading">Hello world</h1>')
    expect(result.body).toContain('<div><p>The first post.</p></div>')
    expect(result.head).toContain(
      '<link rel="canonical" href="https://example.com/blog/hello-world">',
    )
    expect(assembleDocument(result)).toMatchSnapshot()
  })

  it('lets the context site url override the document and trims a trailing slash', () => {
    const doc = fixtureDocument()
    doc.site.url = 'https://doc.example'
    const result = render(doc, doc.pages['p-home']!, undefined, {
      ...ctx,
      siteUrl: 'https://ctx.example/',
    })
    expect(result.head).toContain('href="https://ctx.example/"')
    expect(result.head).not.toContain('doc.example')
  })

  it('appends site and page body code at the end of the body', () => {
    const doc = fixtureDocument()
    doc.site.bodyCode = '<script>a()</script>'
    doc.pages['p-home']!.bodyCode = '<script>b()</script>'
    const { body } = render(doc, doc.pages['p-home']!, undefined, ctx)
    expect(body.endsWith('<script>a()</script><script>b()</script>')).toBe(true)
  })

  it('collects warnings with node ids', () => {
    const doc = fixtureDocument()
    ;(doc.nodes['n-hero-title'] as TextNode).text = {
      type: 'doc',
      content: [{ type: 'mystery', content: [{ type: 'text', text: 'x' }] }],
    } as never
    const { warnings } = render(doc, doc.pages['p-home']!, undefined, ctx)
    expect(warnings).toEqual([{ node: 'n-hero-title', message: 'unknown rich text node mystery' }])
  })

  it('requires an entry for collection pages and a known root', () => {
    const doc = fixtureDocument()
    expect(() => render(doc, doc.pages['p-post']!, undefined, ctx)).toThrow(RenderError)
    doc.pages['p-home']!.root = 'nope'
    expect(() => render(doc, doc.pages['p-home']!, undefined, ctx)).toThrow('unknown node nope')
  })
})
