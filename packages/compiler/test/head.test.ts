import { fixtureDocument } from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import { RenderError } from '../src/errors.js'
import { renderHead } from '../src/head.js'
import { plainImageResolver } from '../src/images.js'

const base = () => {
  const doc = fixtureDocument()
  return { doc, page: doc.pages['p-home']!, path: '/', resolveImage: plainImageResolver }
}

describe('renderHead', () => {
  it('emits charset, viewport, title, description and google fonts', () => {
    const head = renderHead(base())
    expect(head).toContain('<meta charset="utf-8">')
    expect(head).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(head).toContain('<title>Fixture Co</title>')
    expect(head).toContain('<meta name="description" content="A fixture site.">')
    expect(head).toContain('<link rel="preconnect" href="https://fonts.googleapis.com">')
    expect(head).toContain('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
    expect(head).toContain(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&amp;display=swap">',
    )
    expect(head).not.toContain('canonical')
    expect(head).not.toContain('og:url')
  })

  it('adds canonical, open graph url and image, and robots when configured', () => {
    const input = base()
    input.page.seo = { ...input.page.seo, noindex: true, ogImage: 'a-hero' }
    const head = renderHead({ ...input, path: '/blog/x', siteUrl: 'https://example.com/' })
    expect(head).toContain('<link rel="canonical" href="https://example.com/blog/x">')
    expect(head).toContain('<meta property="og:url" content="https://example.com/blog/x">')
    expect(head).toContain('<meta property="og:title" content="Fixture Co">')
    expect(head).toContain(
      '<meta property="og:image" content="https://example.com/assets/fixture-hero.png">',
    )
    expect(head).toContain('<meta name="robots" content="noindex">')
    input.page.seo.canonical = 'https://other.example/x'
    expect(renderHead({ ...input, siteUrl: 'https://example.com' })).toContain(
      '<link rel="canonical" href="https://other.example/x">',
    )
  })

  it('emits font-face and preload for asset fonts, nothing for system fonts', () => {
    const input = base()
    input.doc.assets['a-font'] = {
      id: 'a-font',
      name: 'x.woff2',
      kind: 'font',
      hash: 'ff',
      mime: 'font/woff2',
      size: 1,
    }
    input.doc.site.fonts = [
      { family: 'Custom Sans', source: 'asset', asset: 'a-font', fallback: 'sans-serif' },
      { family: 'Georgia', source: 'system' },
    ]
    const head = renderHead(input)
    expect(head).toContain(
      '<link rel="preload" as="font" type="font/woff2" href="/assets/ff.woff2" crossorigin>',
    )
    expect(head).toContain(
      '@font-face{font-family:"Custom Sans";src:url("/assets/ff.woff2") format("woff2");font-display:swap}',
    )
    expect(head).not.toContain('Georgia')
    input.doc.site.fonts = [{ family: 'Nope', source: 'asset', asset: 'a-missing' }]
    expect(() => renderHead(input)).toThrow(RenderError)
  })

  it('inserts site and page head code verbatim, site first, and falls back to the page name', () => {
    const input = base()
    input.doc.site.headCode = '<script>site()</script>'
    input.page.headCode = '<script>page()</script>'
    input.page.seo = undefined
    const head = renderHead(input)
    expect(head).toContain('<title>Home</title>')
    expect(head.indexOf('site()')).toBeLessThan(head.indexOf('page()'))
    expect(head.indexOf('</title>')).toBeLessThan(head.indexOf('site()'))
  })
})
