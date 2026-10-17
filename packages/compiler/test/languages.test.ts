import {
  type Document,
  fixtureDocument,
  fixtureTwoLanguageDocument,
  type LanguageSwitcherNode,
  parseDocument,
} from '@lacuno/schema'
import { describe, expect, it } from 'vitest'
import { plainImageResolver } from '../src/images.js'
import { render } from '../src/render.js'
import { alternates, enumerateRoutes } from '../src/routes.js'

const site = (change?: (doc: Document) => void) => {
  const doc = fixtureTwoLanguageDocument()
  doc.site.url = 'https://example.com'
  change?.(doc)
  return parseDocument(doc)
}
const ctx = { resolveImage: plainImageResolver }
const entry = (doc: Document, id: string) => doc.entries['col-posts']!.find((e) => e.id === id)

describe('routes in several languages', () => {
  it('adds each published language under its prefix, with translated slugs', () => {
    const doc = site()
    expect(enumerateRoutes(doc).map((r) => `${r.path} ${r.locale ?? ''}`.trim())).toEqual([
      '/',
      '/404',
      '/about',
      '/blog/hello-world',
      '/blog/second-post',
      '/blog/third-post',
      '/de de',
      '/de/404 de',
      '/de/blog/hallo-welt de',
      '/de/blog/second-post de',
      '/de/blog/third-post de',
      '/de/ueber-uns de',
    ])
  })

  it('leaves draft languages out unless asked for them', () => {
    const paths = enumerateRoutes(site(), { drafts: true }).map((r) => r.path)
    expect(paths).toContain('/fr/about')
    expect(paths).toHaveLength(18)
  })

  it('finds a page in every published language, the primary first', () => {
    const doc = site()
    expect(alternates(doc, { page: 'p-about' })).toEqual([
      { locale: 'en', path: '/about' },
      { locale: 'de', path: '/de/ueber-uns' },
    ])
    expect(alternates(doc, { page: 'p-post', entry: 'e-1' })).toEqual([
      { locale: 'en', path: '/blog/hello-world' },
      { locale: 'de', path: '/de/blog/hallo-welt' },
    ])
  })
})

describe('rendering a language', () => {
  it('renders the translated page with links, lang and alternates in that language', () => {
    const doc = site()
    const result = render(doc, doc.pages['p-about']!, undefined, { ...ctx, locale: 'de' })
    expect(result.htmlAttrs).toEqual({ lang: 'de' })
    expect(result.body).toContain('<h1>Über uns</h1>')
    expect(result.body).toContain('<a href="/de">Zur Startseite</a>')
    expect(result.head).toContain('<title>Über uns</title>')
    expect(result.head).toContain('<link rel="canonical" href="https://example.com/de/ueber-uns">')
    const hreflang = [
      '<link rel="alternate" hreflang="en" href="https://example.com/about">',
      '<link rel="alternate" hreflang="de" href="https://example.com/de/ueber-uns">',
      '<link rel="alternate" hreflang="x-default" href="https://example.com/about">',
    ].join('\n')
    expect(result.head).toContain(hreflang)
    const primary = render(doc, doc.pages['p-about']!, undefined, ctx)
    expect(primary.htmlAttrs).toEqual({ lang: 'en' })
    expect(primary.body).toContain('<h1>About us</h1>')
    expect(primary.head).toContain(hreflang)
  })

  it('renders a collection page in both languages, noindex in both', () => {
    const doc = site()
    const page = doc.pages['p-post']!
    const de = render(doc, page, entry(doc, 'e-1'), { ...ctx, locale: 'de' })
    expect(de.htmlAttrs).toEqual({ lang: 'de' })
    expect(de.body).toContain('<h1 class="heading">Hallo Welt</h1>')
    expect(de.head).toContain(
      '<link rel="canonical" href="https://example.com/de/blog/hallo-welt">',
    )
    expect(de.head).toContain('hreflang="en" href="https://example.com/blog/hello-world"')
    const en = render(doc, page, entry(doc, 'e-1'), ctx)
    expect(en.htmlAttrs).toEqual({ lang: 'en-GB' })
    expect(en.body).toContain('<h1 class="heading">Hello world</h1>')
    for (const result of [de, en])
      expect(result.head).toContain('<meta name="robots" content="noindex">')
  })

  it('names the other languages with a territory in og:locale:alternate', () => {
    const doc = site((d) => {
      d.site.locales = [{ code: 'en-US' }, { code: 'de-AT' }, { code: 'fr' }]
      d.translations = {}
    })
    const result = render(doc, doc.pages['p-home']!, undefined, { ...ctx, locale: 'de-AT' })
    expect(result.head).toContain('<meta property="og:locale" content="de_AT">')
    expect(result.head).toContain('<meta property="og:locale:alternate" content="en_US">')
    expect(result.head).not.toContain('og:locale:alternate" content="de_AT"')
    expect(result.head).toContain('hreflang="de-AT" href="https://example.com/de-at"')
  })

  it('leaves a one-language site as it was', () => {
    const doc = fixtureDocument()
    doc.site.url = 'https://example.com'
    const result = render(doc, doc.pages['p-home']!, undefined, ctx)
    expect(result.head).not.toContain('hreflang')
    expect(result.head).not.toContain('og:locale:alternate')
  })
})

describe('language switcher', () => {
  const about = (doc: Document, locale?: string, annotateNodes?: boolean) =>
    render(doc, doc.pages['p-about']!, undefined, {
      ...ctx,
      ...(locale ? { locale } : {}),
      ...(annotateNodes ? { annotateNodes } : {}),
    }).body
  const switcher = (change: Partial<LanguageSwitcherNode>) =>
    site((d) => Object.assign(d.nodes['n-switcher']!, change))

  it('links the page in each language, marking the current one', () => {
    expect(about(site(), 'de')).toContain(
      '<nav aria-label="Language"><a href="/about" hreflang="en" lang="en">English</a><a aria-current="true" href="/de/ueber-uns" hreflang="de" lang="de">Deutsch</a></nav>',
    )
  })

  it('opens as a dropdown showing the current language', () => {
    expect(about(switcher({ display: 'dropdown' }))).toContain(
      '<nav aria-label="Language"><details><summary>English</summary><a aria-current="true" href="/about"',
    )
  })

  it('reads the code, both, or the label the site gives a language', () => {
    expect(about(switcher({ label: 'code' }))).toContain('>EN</a>')
    expect(about(switcher({ label: 'both' }), 'de')).toContain('>Deutsch (DE)</a>')
    const labelled = site((d) => {
      d.site.locales![1]!.label = 'German'
    })
    expect(about(labelled)).toContain('>German</a>')
  })

  it('takes its own aria-label and classes', () => {
    const doc = switcher({
      attrs: { 'aria-label': { type: 'static', value: 'Sprache' } },
      classes: ['c-button'],
    })
    expect(about(doc)).toContain('<nav aria-label="Sprache" class="button"')
  })

  it('publishes nothing for one language and shows the one on the canvas', () => {
    const doc = site((d) => {
      d.site.locales = [{ code: 'en' }]
      d.translations = {}
    })
    expect(about(doc)).toBe('<main class="page"><h1>About us</h1><a href="/">Back home</a></main>')
    expect(about(doc, undefined, true)).toContain(
      '<nav aria-label="Language" data-lacuno-node="n-switcher"><a aria-current="true" href="/about" hreflang="en" lang="en">English</a></nav>',
    )
  })
})
