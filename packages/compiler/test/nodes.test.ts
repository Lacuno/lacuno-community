import { classNames } from '@freeflow/css'
import { createEmptyDocument, type Document, fixtureDocument, type Node } from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import { RenderError } from '../src/errors.js'
import { plainImageResolver } from '../src/images.js'
import { type RenderState, renderNode } from '../src/nodes.js'
import type { Scope } from '../src/scope.js'

function state(doc: Document): RenderState {
  return { doc, names: classNames(doc), resolveImage: plainImageResolver, page: 'p', warnings: [] }
}
const empty: Scope = { frames: [] }

function withNodes(nodes: Node[]): Document {
  const doc = createEmptyDocument()
  for (const n of nodes) doc.nodes[n.id] = n
  return doc
}

describe('renderNode: elements and text', () => {
  it('renders elements with classes, static attrs, void tags and escaping', () => {
    const doc = withNodes([
      {
        id: 'a',
        type: 'element',
        tag: 'section',
        parent: null,
        children: ['b', 'c'],
        classes: ['x'],
        attrs: {
          'data-x': { type: 'static', value: 'a "q" <b>' },
          hidden: { type: 'static', value: true },
          'aria-busy': { type: 'static', value: false },
        },
      },
      { id: 'b', type: 'element', tag: 'hr', parent: 'a', children: [], classes: [] },
      {
        id: 'c',
        type: 'text',
        tag: 'p',
        parent: 'a',
        children: [],
        classes: [],
        text: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x < y' }] }],
        },
      },
    ])
    doc.classes.x = { id: 'x', kind: 'class', name: 'Box' }
    expect(renderNode('a', empty, state(doc))).toBe(
      '<section class="box" data-x="a &quot;q&quot; &lt;b&gt;" hidden><hr><p>x &lt; y</p></section>',
    )
  })

  it('renders bound text as escaped strings or rich text blocks', () => {
    const doc = fixtureDocument()
    const s = state(doc)
    const scope: Scope = {
      entry: doc.entries['col-posts']![0]!,
      collection: doc.collections['col-posts']!,
      frames: [],
    }
    expect(renderNode('n-post-title', scope, s)).toBe('<h1 class="heading">Hello world</h1>')
    expect(renderNode('n-post-body', scope, s)).toBe('<div><p>The first post.</p></div>')
    const noBody: Scope = { ...scope, entry: doc.entries['col-posts']![1]! }
    expect(renderNode('n-post-body', noBody, s)).toBe('<div></div>')
  })

  it('renders images through the resolver with dimensions, lazy loading and alt fallback', () => {
    const doc = fixtureDocument()
    const s = state(doc)
    s.resolveImage = () => ({
      src: '/_astro/h.webp',
      srcset: '/_astro/h-640.webp 640w, /_astro/h.webp 1200w',
      width: 1200,
      height: 800,
      sources: [{ type: 'image/avif', srcset: '/_astro/h.avif 1200w' }],
    })
    expect(renderNode('n-hero-image', empty, s)).toBe(
      '<picture><source sizes="100vw" srcset="/_astro/h.avif 1200w" type="image/avif"><img alt="A blue rectangle standing in for a hero image" decoding="async" height="800" loading="eager" sizes="100vw" src="/_astro/h.webp" srcset="/_astro/h-640.webp 640w, /_astro/h.webp 1200w" width="1200"></picture>',
    )
    const img = doc.nodes['n-hero-image'] as Extract<Node, { type: 'element' }>
    img.attrs = { src: { type: 'asset', asset: 'a-hero' } }
    s.resolveImage = plainImageResolver
    expect(renderNode('n-hero-image', empty, s)).toBe(
      '<img alt="Hero image" decoding="async" height="800" loading="lazy" sizes="100vw" src="/assets/fixture-hero.png" width="1200">',
    )
  })

  it('links non-image assets by public path and rejects unknown classes', () => {
    const doc = fixtureDocument()
    doc.assets['a-pdf'] = {
      id: 'a-pdf',
      name: 'x.pdf',
      kind: 'file',
      hash: 'abc',
      mime: 'application/pdf',
      size: 1,
    }
    doc.nodes.link = {
      id: 'link',
      type: 'element',
      tag: 'a',
      parent: null,
      children: [],
      classes: [],
      attrs: { href: { type: 'asset', asset: 'a-pdf' } },
    }
    expect(renderNode('link', empty, state(doc))).toBe('<a href="/assets/abc.pdf"></a>')
    doc.nodes.link.classes = ['c-nope']
    expect(() => renderNode('link', empty, state(doc))).toThrow(RenderError)
  })

  it('rejects unknown nodes and code components', () => {
    const doc = withNodes([
      {
        id: 'cc',
        type: 'code-component',
        parent: null,
        children: [],
        classes: [],
        source: 'Map.astro',
      },
    ])
    expect(() => renderNode('missing', empty, state(doc))).toThrow('unknown node missing')
    expect(() => renderNode('cc', empty, state(doc))).toThrow(
      'code components are not supported yet',
    )
  })
})
