import { describe, expect, it } from 'vitest'
import {
  type ComponentInstanceNode,
  checkReferences,
  type FieldDef,
  fixtureDocument,
  fixtureTwoLanguageDocument,
  isTranslatable,
  localize,
  pageLang,
  parseDocument,
  parseKey,
  publishedLocales,
  siteLocales,
  sourceHash,
  type TextNode,
  translationKeys,
  translationProgress,
  translationStatus,
} from '../src/index.js'

const messages = (doc: ReturnType<typeof fixtureDocument>) =>
  checkReferences(doc).map((i) => `${i.path}: ${i.message}`)

describe('languages', () => {
  it('reads a document without languages as one in its locale', () => {
    const doc = parseDocument(fixtureDocument())
    expect(siteLocales(doc)).toEqual([{ code: 'en' }])
    expect(doc.translations).toEqual({})
    expect(localize(doc, 'en')).toBe(doc)
  })

  it('takes the first language as the primary and leaves drafts unpublished', () => {
    const doc = parseDocument(fixtureTwoLanguageDocument())
    expect(publishedLocales(doc).map((l) => l.code)).toEqual(['en', 'de'])
    doc.site.locale = 'fr'
    expect(pageLang(doc, doc.pages['p-home']!)).toBe('en')
  })

  it('refuses a language twice', () => {
    const doc = fixtureTwoLanguageDocument()
    doc.site.locales = [{ code: 'en' }, { code: 'en' }]
    expect(() => parseDocument(doc)).toThrow(/each language once/)
  })
})

describe('translation keys', () => {
  it('parses every kind of key', () => {
    expect(parseKey('node:n1.text')).toEqual({ type: 'node', id: 'n1', part: 'text' })
    expect(parseKey('node:n1.attr.aria-label')).toEqual({
      type: 'node',
      id: 'n1',
      part: 'attr',
      name: 'aria-label',
    })
    expect(parseKey('node:n1.prop.title')).toMatchObject({ part: 'prop', name: 'title' })
    expect(parseKey('page:p1.seo.ogImage')).toEqual({ type: 'page', id: 'p1', part: 'ogImage' })
    expect(parseKey('page:p1.path')).toMatchObject({ part: 'path' })
    expect(parseKey('entry:e1.f-title')).toEqual({ type: 'entry', id: 'e1', field: 'f-title' })
    expect(parseKey('site.titleTemplate')).toEqual({ type: 'site' })
    expect(parseKey('node:n1.attr.href')).toBeUndefined()
    expect(parseKey('page:p1.seo.canonical')).toBeUndefined()
    expect(parseKey('nodes.n1.text')).toBeUndefined()
  })

  it('translates text fields by default and others when they say so', () => {
    const field = (type: string, translatable?: boolean) =>
      ({ id: 'f', name: 'f', label: 'F', type, translatable }) as FieldDef
    expect(
      ['text', 'richtext', 'slug', 'number', 'image', 'date'].map((t) => isTranslatable(field(t))),
    ).toEqual([true, true, true, false, false, false])
    expect(isTranslatable(field('text', false))).toBe(false)
    expect(isTranslatable(field('image', true))).toBe(true)
    expect(isTranslatable(field('number', true))).toBe(false)
  })
})

describe('localize', () => {
  const doc = parseDocument(fixtureTwoLanguageDocument())
  const de = localize(doc, 'de')

  it('applies each kind of translation and keeps the primary value where one is missing', () => {
    expect(de.pages['p-about']).toMatchObject({
      path: '/de/ueber-uns',
      name: 'Über uns',
      lang: 'de',
    })
    expect(de.pages['p-home']!.path).toBe('/de')
    expect(de.pages['p-post']!.path).toBe('/de/blog/[slug]')
    expect(de.pages['p-home']!.seo).toEqual({
      title: 'Fixture GmbH',
      description: 'A fixture site.',
    })
    expect((de.nodes['n-about-home'] as TextNode).text).toEqual({
      type: 'static',
      value: 'Zur Startseite',
    })
    expect(de.nodes['n-hero-image']!.attrs!.alt).toEqual({
      type: 'static',
      value: 'Ein blaues Rechteck anstelle eines Titelbilds',
    })
    expect(de.entries['col-posts']![0]!.fields['f-slug']).toBe('hallo-welt')
    expect(de.entries['col-posts']![1]!.fields['f-slug']).toBe('second-post')
    expect(de.site.locale).toBe('de')
  })

  it('leaves the document alone and remembers each language', () => {
    expect(doc.pages['p-about']!.path).toBe('/about')
    expect(localize(doc, 'de')).toBe(de)
    expect(localize(doc, 'fr').pages['p-about']!.path).toBe('/fr/about')
  })

  it('applies a prop and the title template', () => {
    const d = fixtureTwoLanguageDocument()
    ;(d.nodes['n-post-card'] as ComponentInstanceNode).props = {
      title: { type: 'static', value: 'Card' },
    }
    d.site.titleTemplate = '{page} | Fixture'
    d.translations.de!['node:n-post-card.prop.title'] = { value: 'Karte', source: '' }
    d.translations.de!['site.titleTemplate'] = { value: '{page} | Fixtur', source: '' }
    const local = localize(parseDocument(d), 'de')
    expect(local.nodes['n-post-card']).toMatchObject({ props: { title: { value: 'Karte' } } })
    expect(local.site.titleTemplate).toBe('{page} | Fixtur')
  })
})

describe('translation status', () => {
  it('is missing, done, or outdated once the primary value changes', () => {
    const doc = fixtureTwoLanguageDocument()
    expect(translationStatus(doc, 'de', 'page:p-about.name')).toBe('done')
    expect(translationStatus(doc, 'de', 'page:p-post.name')).toBe('missing')
    doc.pages['p-about']!.name = 'About us'
    expect(translationStatus(doc, 'de', 'page:p-about.name')).toBe('outdated')
  })

  it('hashes equal values alike, whatever their key order', () => {
    expect(sourceHash({ a: 1, b: [2] })).toBe(sourceHash({ b: [2], a: 1 }))
    expect(sourceHash('a')).not.toBe(sourceHash('b'))
    expect(sourceHash('a')).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('translation checks', () => {
  it('accepts the two-language fixture', () => {
    expect(messages(fixtureTwoLanguageDocument())).toEqual([])
  })

  it('reports unknown languages, bad keys and values of the wrong kind', () => {
    const doc = fixtureTwoLanguageDocument()
    doc.translations.it = { 'page:p-about.name': { value: 'Chi siamo', source: '' } }
    doc.translations.de!['page:p-about.nope'] = { value: 'x', source: '' }
    doc.translations.de!['page:p-about.path'] = { value: 'Über Uns', source: '' }
    doc.translations.de!['node:n-about-title.text'] = { value: 'plain', source: '' }
    doc.translations.de!['page:p-home.seo.ogImage'] = { value: 'a-missing', source: '' }
    expect(messages(doc)).toEqual([
      'translations.de.page:p-about.path: a slug is lower-case letters, digits and dashes',
      'translations.de.node:n-about-title.text: Invalid input: expected object, received string',
      'translations.de.page:p-about.nope: page:p-about.nope is not a translation key',
      'translations.de.page:p-home.seo.ogImage: unknown asset a-missing',
      'translations.it: unknown language it',
    ])
  })

  it('leaves translations of removed values alone', () => {
    const doc = fixtureTwoLanguageDocument()
    doc.translations.de!['node:n-gone.text'] = { value: 'weg', source: '' }
    expect(messages(doc)).toEqual([])
    expect(localize(parseDocument(doc), 'de').nodes['n-gone']).toBeUndefined()
  })

  it('reports a translated slug that collides inside one language', () => {
    const doc = fixtureTwoLanguageDocument()
    doc.pages['p-team'] = { id: 'p-team', name: 'Team', path: '/team', root: 'n-not-found' }
    delete doc.pages['p-not-found']
    doc.translations.de!['page:p-about.path'] = { value: 'team', source: '' }
    doc.translations.de!['entry:e-1.f-slug'] = { value: 'second-post', source: '' }
    expect(messages(doc)).toEqual([
      'translations.de: path /de/team is used by pages p-about and p-team',
      'translations.de: slug second-post is used by entries e-1 and e-2',
    ])
  })

  it('reports a page at the address of a language', () => {
    const doc = fixtureTwoLanguageDocument()
    doc.pages['p-about']!.path = '/de'
    expect(messages(doc)).toContain('pages.p-about: path /de is the address of language de')
  })
})

describe('translation keys of a document', () => {
  const doc = parseDocument(fixtureTwoLanguageDocument())

  it('lists every translatable value in order, with its kind and where it is', () => {
    const items = translationKeys(doc)
    expect(items.slice(0, 4).map((i) => i.key)).toEqual([
      'page:p-home.name',
      'page:p-home.seo.title',
      'page:p-home.seo.description',
      'node:n-hero-title.text',
    ])
    expect(items.find((i) => i.key === 'page:p-about.path')).toEqual({
      key: 'page:p-about.path',
      kind: 'slug',
      value: 'about',
      context: { type: 'page', page: 'p-about' },
    })
    expect(items.find((i) => i.key === 'node:n-hero-image.attr.alt')?.context).toEqual({
      type: 'page',
      page: 'p-home',
      node: 'n-hero-image',
    })
    expect(items.at(-1)).toMatchObject({
      key: 'entry:e-3.f-slug',
      context: { type: 'entry', collection: 'col-posts', entry: 'e-3', field: 'f-slug' },
    })
    // The home page's path and a collection page's [slug] have no segment of their own.
    expect(items.map((i) => i.key)).not.toContain('page:p-home.path')
    expect(items.map((i) => i.key)).not.toContain('page:p-post.path')
  })

  it('counts a language done, outdated and missing for the site or one page', () => {
    expect(translationProgress(doc, 'de')).toEqual({ done: 9, outdated: 0, missing: 16 })
    expect(translationProgress(doc, 'de', 'p-about')).toEqual({ done: 4, outdated: 0, missing: 0 })
    // A collection page counts its collection's entries.
    expect(translationProgress(doc, 'de', 'p-post')).toEqual({ done: 2, outdated: 0, missing: 6 })
    const changed = fixtureTwoLanguageDocument()
    changed.pages['p-about']!.name = 'About us'
    expect(translationProgress(changed, 'de', 'p-about')).toEqual({
      done: 3,
      outdated: 1,
      missing: 0,
    })
  })
})
