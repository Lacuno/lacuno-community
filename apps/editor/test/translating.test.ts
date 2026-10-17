import type { Operation } from '@lacuno/document'
import { fixtureTwoLanguageDocument, localize, parseDocument } from '@lacuno/schema'
import { describe, expect, it } from 'vitest'
import { toTranslations } from '../src/translating.js'

const doc = parseDocument(fixtureTwoLanguageDocument())
const de = localize(doc, 'de')
const map = (...operations: Operation[]) => toTranslations(doc, 'de', operations)
const paragraph = (text: string) => ({
  type: 'doc' as const,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('edits in another language', () => {
  it('turns text, attributes and props into translations', () => {
    expect(map({ type: 'node.update', id: 'n-hero-title', text: paragraph('Neu') })).toEqual([
      {
        type: 'translation.set',
        locale: 'de',
        key: 'node:n-hero-title.text',
        value: paragraph('Neu'),
      },
    ])
    // The canvas's editor hands back rich text for a plain text, which stays plain.
    expect(map({ type: 'node.update', id: 'n-step-1', text: paragraph('Schritt') })).toEqual([
      { type: 'translation.set', locale: 'de', key: 'node:n-step-1.text', value: 'Schritt' },
    ])
    const attrs = {
      ...de.nodes['n-hero-image']!.attrs,
      alt: { type: 'static' as const, value: 'Bild' },
    }
    expect(map({ type: 'node.update', id: 'n-hero-image', attrs })).toEqual([
      { type: 'translation.set', locale: 'de', key: 'node:n-hero-image.attr.alt', value: 'Bild' },
    ])
  })

  it('turns page, entry and site fields into translations', () => {
    expect(
      map({
        type: 'page.update',
        id: 'p-about',
        name: 'Wir',
        path: '/de/wir',
        seo: { title: 'Über uns' },
      }),
    ).toEqual([
      { type: 'translation.set', locale: 'de', key: 'page:p-about.name', value: 'Wir' },
      { type: 'translation.set', locale: 'de', key: 'page:p-about.path', value: 'wir' },
      { type: 'translation.set', locale: 'de', key: 'page:p-about.seo.title', value: 'Über uns' },
    ])
    expect(
      map({
        type: 'entry.update',
        collection: 'col-posts',
        id: 'e-2',
        fields: { 'f-title': 'Zwei' },
      }),
    ).toEqual([{ type: 'translation.set', locale: 'de', key: 'entry:e-2.f-title', value: 'Zwei' }])
    expect(map({ type: 'site.update', titleTemplate: '{page} | DE' })).toEqual([
      { type: 'translation.set', locale: 'de', key: 'site.titleTemplate', value: '{page} | DE' },
    ])
  })

  it('removes a translation set back to the primary value or cleared, and skips unchanged ones', () => {
    expect(
      map({
        type: 'node.update',
        id: 'n-about-home',
        text: { type: 'static', value: 'Back home' },
      }),
    ).toEqual([{ type: 'translation.delete', locale: 'de', key: 'node:n-about-home.text' }])
    expect(
      map({ type: 'page.update', id: 'p-home', seo: { description: 'A fixture site.' } }),
    ).toEqual([{ type: 'translation.delete', locale: 'de', key: 'page:p-home.seo.title' }])
    expect(
      map({ type: 'page.update', id: 'p-about', name: 'Über uns', path: '/de/ueber-uns' }),
    ).toEqual([])
  })

  it('keeps a page path to its own last segment', () => {
    expect(() => map({ type: 'page.update', id: 'p-about', path: '/de/team/wir' })).toThrow(
      'Change the layout in English',
    )
  })

  it('refuses every change to the layout, classes, styles and untranslated values', () => {
    const refused: Operation[] = [
      {
        type: 'node.create',
        parent: 'n-about',
        index: 0,
        node: { id: 'n-x', type: 'element', tag: 'div' },
      } as Operation,
      { type: 'node.move', id: 'n-about-home', parent: 'n-about', index: 0 },
      { type: 'node.delete', id: 'n-about-home' },
      { type: 'node.update', id: 'n-about-home', classes: ['c-page'] },
      { type: 'node.update', id: 'n-about-home', tag: 'p' },
      {
        type: 'node.update',
        id: 'n-hero-image',
        attrs: { ...de.nodes['n-hero-image']!.attrs, loading: { type: 'static', value: 'lazy' } },
      },
      { type: 'class.create', id: 'c-new', local: true },
      {
        type: 'style.set',
        class: 'c-page',
        breakpoint: 'base',
        state: 'none',
        property: 'color',
        value: { type: 'keyword', value: 'red' },
      } as Operation,
      { type: 'page.create', id: 'p-new', name: 'New', path: '/new' },
      { type: 'page.update', id: 'p-about', seo: { noindex: true } },
      { type: 'page.update', id: 'p-about', headCode: '<meta>' },
      {
        type: 'entry.update',
        collection: 'col-posts',
        id: 'e-1',
        fields: { 'f-date': '2026-01-01' },
      },
      { type: 'site.update', name: 'Andere' },
    ]
    for (const op of refused) expect(() => map(op), op.type).toThrow('Change the layout in English')
  })

  it('lets language and translation operations through', () => {
    const ops: Operation[] = [
      { type: 'locale.update', code: 'fr', draft: false },
      { type: 'translation.delete', locale: 'de', key: 'page:p-about.name' },
    ]
    expect(map(...ops)).toEqual(ops)
  })
})
