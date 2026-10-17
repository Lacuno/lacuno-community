import {
  fixtureDocument,
  fixtureTwoLanguageDocument,
  parseDocument,
  sourceHash,
  translationStatus,
} from '@lacuno/schema'
import { describe, expect, it } from 'vitest'
import { planBatch } from '../src/engine.js'
import { OperationError } from '../src/errors.js'
import { OPERATIONS_BY_TYPE, type Operation } from '../src/operations/index.js'
import { applyPatches, invertPatches } from '../src/patch.js'

const run = (ops: Operation[], doc = fixtureTwoLanguageDocument()) => {
  const result = planBatch(doc, ops, OPERATIONS_BY_TYPE)
  parseDocument(result.document)
  return result
}
const failing = (ops: Operation[], pattern: RegExp, doc = fixtureTwoLanguageDocument()) => {
  try {
    planBatch(doc, ops, OPERATIONS_BY_TYPE)
    expect.unreachable()
  } catch (e) {
    expect(e).toBeInstanceOf(OperationError)
    expect((e as OperationError).message).toMatch(pattern)
  }
}
const keys = (doc: { translations: Record<string, object> }, locale = 'de') =>
  Object.keys(doc.translations[locale] ?? {})

describe('languages', () => {
  it('adds a language to a one-language site, the site locale first', () => {
    const { document } = run(
      [
        { type: 'locale.add', code: 'de' },
        { type: 'locale.add', code: 'fr', label: 'Français', draft: true },
      ],
      fixtureDocument(),
    )
    expect(document.site.locales).toEqual([
      { code: 'en' },
      { code: 'de' },
      { code: 'fr', label: 'Français', draft: true },
    ])
    failing([{ type: 'locale.add', code: 'de' }], /language de already exists/)
  })

  it('updates a label and the draft flag', () => {
    const { document } = run([
      { type: 'locale.update', code: 'fr', draft: false, label: 'Français' },
      { type: 'locale.update', code: 'de', label: 'Deutsch' },
      { type: 'locale.update', code: 'de', label: null },
    ])
    expect(document.site.locales).toEqual([
      { code: 'en' },
      { code: 'de' },
      { code: 'fr', label: 'Français' },
    ])
    failing(
      [{ type: 'locale.update', code: 'en', draft: true }],
      /primary language cannot be a draft/,
    )
    failing([{ type: 'locale.update', code: 'it' }], /unknown language it/)
  })

  it('removes a language with its translations, but never the primary', () => {
    const { document } = run([{ type: 'locale.remove', code: 'de' }])
    expect(document.site.locales!.map((l) => l.code)).toEqual(['en', 'fr'])
    expect(document.translations.de).toBeUndefined()
    failing([{ type: 'locale.remove', code: 'en' }], /primary language and cannot be removed/)
  })

  it('reorders, the first becoming the primary and translations staying by language', () => {
    const { document } = run([{ type: 'locale.reorder', codes: ['de', 'en', 'fr'] }])
    expect(document.site.locales!.map((l) => l.code)).toEqual(['de', 'en', 'fr'])
    expect(document.site.locale).toBe('de')
    expect(keys(document)).toContain('page:p-about.path')
    failing([{ type: 'locale.reorder', codes: ['de', 'en'] }], /each language once/)
    failing([{ type: 'locale.reorder', codes: ['fr', 'en', 'de'] }], /cannot be a draft/)
  })

  it('keeps the first language on the site locale', () => {
    const { document } = run([{ type: 'site.update', locale: 'en-GB' }])
    expect(document.site.locales![0]).toEqual({ code: 'en-GB' })
  })
})

describe('language switcher', () => {
  it('is created and updated through operations, without children', () => {
    const { document } = run([
      {
        type: 'node.create',
        parent: 'n-home',
        node: { type: 'language-switcher', id: 'n-langs', display: 'dropdown' },
      },
      { type: 'node.update', id: 'n-langs', label: 'both', display: null },
    ])
    expect(document.nodes['n-langs']).toMatchObject({ type: 'language-switcher', label: 'both' })
    expect(document.nodes['n-langs']).not.toHaveProperty('display')
    failing(
      [
        {
          type: 'node.create',
          parent: 'n-home',
          node: { type: 'language-switcher', children: [{ type: 'element', tag: 'b' }] },
        },
      ],
      /cannot have children/,
    )
    failing([{ type: 'node.update', id: 'n-hero', label: 'code' }], /language switchers only/)
  })
})

describe('translations', () => {
  it('sets a translation with the hash of the primary value', () => {
    const { document } = run([
      { type: 'translation.set', locale: 'de', key: 'page:p-post.name', value: 'Beitrag' },
    ])
    expect(document.translations.de!['page:p-post.name']).toEqual({
      value: 'Beitrag',
      source: sourceHash('Post'),
    })
    expect(translationStatus(document, 'de', 'page:p-post.name')).toBe('done')
  })

  it('refuses the primary, unknown languages, missing targets and wrong values', () => {
    const set = (locale: string, key: string, value: unknown): Operation[] => [
      { type: 'translation.set', locale, key, value },
    ]
    failing(set('en', 'page:p-post.name', 'Post'), /en is the primary language/)
    failing(set('it', 'page:p-post.name', 'Post'), /unknown language it/)
    failing(set('de', 'node:n-gone.text', 'x'), /nothing to translate at node:n-gone.text/)
    failing(set('de', 'page:p-home.path', 'start'), /nothing to translate/)
    failing(set('de', 'node:n-hero.attr.href', '/x'), /is not a translation key/)
    failing(set('de', 'page:p-post.name', 3), /expected string/)
  })

  it('deletes a translation, and undoes', () => {
    const doc = fixtureTwoLanguageDocument()
    const { document, patches } = run(
      [{ type: 'translation.delete', locale: 'de', key: 'page:p-about.name' }],
      doc,
    )
    expect(keys(document)).not.toContain('page:p-about.name')
    expect(applyPatches(document, invertPatches(doc, patches))).toEqual(doc)
    failing(
      [{ type: 'translation.delete', locale: 'de', key: 'page:p-post.name' }],
      /no de translation/,
    )
  })
})

describe('removals take their translations', () => {
  it('a node, with its subtree', () => {
    const { document } = run([{ type: 'node.delete', id: 'n-hero' }])
    expect(keys(document).filter((k) => k.startsWith('node:n-hero'))).toEqual([])
    expect(keys(document)).toContain('node:n-about-title.text')
  })

  it('a page, with its nodes', () => {
    const { document } = run([{ type: 'page.delete', id: 'p-about' }])
    expect(keys(document).filter((k) => k.includes('about'))).toEqual([])
    expect(keys(document, 'fr')).toEqual([])
  })

  it('an entry, a field and a collection', () => {
    expect(
      keys(run([{ type: 'entry.delete', collection: 'col-posts', id: 'e-1' }]).document),
    ).not.toContain('entry:e-1.f-title')
    const field = run(
      [{ type: 'field.remove', collection: 'col-posts', id: 'f-title' }],
      titleless(),
    )
    expect(keys(field.document)).toEqual(expect.not.arrayContaining(['entry:e-1.f-title']))
    expect(keys(field.document)).toContain('entry:e-1.f-slug')
  })

  it('a component prop, on every instance', () => {
    const doc = fixtureTwoLanguageDocument()
    doc.nodes['n-post-card'] = { ...doc.nodes['n-post-card']!, props: {} } as never
    doc.translations.de!['node:n-post-card.prop.title'] = { value: 'Karte', source: '' }
    const { document } = run([{ type: 'component.update', id: 'cmp-card', props: [] }], doc)
    expect(keys(document)).not.toContain('node:n-post-card.prop.title')
  })
})

/** The two-language fixture with nothing bound to the post title, so the field can go. */
function titleless() {
  const doc = fixtureTwoLanguageDocument()
  doc.nodes['n-post-card'] = { ...doc.nodes['n-post-card']!, props: {} } as never
  doc.nodes['n-post-title'] = {
    ...doc.nodes['n-post-title']!,
    text: { type: 'static', value: 'x' },
  } as never
  return doc
}
