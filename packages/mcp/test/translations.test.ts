import { DocumentStore } from '@lacuno/document'
import {
  type Document,
  fixtureTwoLanguageDocument,
  plainText,
  translationProgress,
} from '@lacuno/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { connect, jsonOf } from './helpers.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
})

type Item = { key: string; kind: string; source: unknown; current?: unknown; status: string }
type Listed = {
  revision: number
  tone?: string
  glossary: { term: string; translation?: string }[]
  items: (Item & { context: string })[]
  next?: string
}

async function start(change?: (doc: Document) => void) {
  const doc = fixtureTwoLanguageDocument()
  change?.(doc)
  const store = DocumentStore.inMemory(doc)
  const applied: unknown[] = []
  const c = await connect(store, { onApply: (batch) => applied.push(batch) })
  close = c.close
  const call = (name: string, args: Record<string, unknown>) =>
    c.client.callTool({ name, arguments: args })
  return { store, applied, call }
}

/** A made-up translation of a source value of any kind, marks and links kept. */
function translate({ kind, source }: Item): unknown {
  if (kind === 'slug') return `de-${source}`
  if (kind === 'asset' || kind === 'template') return source
  if (kind === 'richtext')
    return JSON.parse(JSON.stringify(source), (key, value) =>
      key === 'text' ? `DE ${value}` : value,
    )
  return `DE ${source}`
}

describe('translations.list', () => {
  it('lists the missing and outdated values in order, by page, in pages', async () => {
    const { call, store } = await start((doc) => {
      doc.site.locales![1] = { code: 'de', tone: 'informal' }
      // A changed source makes its translation outdated.
      doc.pages['p-about']!.name = 'About us'
    })
    const all = jsonOf<Listed>(await call('translations.list', { locale: 'de' }))
    expect(all.revision).toBe(0)
    expect(all.tone).toBe('informal')
    expect(all.next).toBeUndefined()
    const statuses = new Set(all.items.map((i) => i.status))
    expect(statuses).toEqual(new Set(['missing', 'outdated']))
    expect(all.items.find((i) => i.key === 'page:p-about.name')).toMatchObject({
      status: 'outdated',
      source: 'About us',
      current: 'Über uns',
      context: 'page About us (/about), page name',
    })
    const title = all.items.find((i) => i.key === 'node:n-hero-cta.text')!
    expect(title.context).toBe('page Home (/), a text')
    const outdated = jsonOf<Listed>(
      await call('translations.list', { locale: 'de', status: 'outdated' }),
    )
    expect(outdated.items.map((i) => i.key)).toEqual(['page:p-about.name'])
    const done = jsonOf<Listed>(await call('translations.list', { locale: 'de', status: 'all' }))
    expect(done.items.length).toBeGreaterThan(all.items.length)

    // Paging: the pages read together are the whole list.
    const first = jsonOf<Listed>(await call('translations.list', { locale: 'de', limit: 3 }))
    expect(first.items).toHaveLength(3)
    const rest = jsonOf<Listed>(
      await call('translations.list', { locale: 'de', limit: 500, cursor: first.next }),
    )
    expect([...first.items, ...rest.items].map((i) => i.key)).toEqual(all.items.map((i) => i.key))
    expect(first.next).toBe(first.items[2]!.key)

    // One page: its own values and its elements'.
    const about = jsonOf<Listed>(
      await call('translations.list', { locale: 'de', page: 'p-about', status: 'all' }),
    )
    expect(about.items.map((i) => i.key).every((k) => /p-about|n-about|n-switcher/.test(k))).toBe(
      true,
    )
    expect(about.items.length).toBe(
      Object.values(translationProgress(store.read().document, 'de', 'p-about')).reduce(
        (a, b) => a + b,
      ),
    )
  })

  it('gives the glossary terms that matter in the language', async () => {
    const { call } = await start((doc) => {
      doc.site.glossary = [
        { term: 'Lacuno' },
        { term: 'Site', translations: { de: 'Website' }, note: 'the whole site' },
        { term: 'Page', translations: { fr: 'Page' } },
      ]
    })
    const listed = jsonOf<Listed>(await call('translations.list', { locale: 'de' }))
    expect(listed.glossary).toEqual([
      { term: 'Lacuno' },
      { term: 'Site', translation: 'Website', note: 'the whole site' },
    ])
  })

  it('refuses the primary, an unknown language, page or cursor', async () => {
    const { call } = await start()
    const error = async (args: Record<string, unknown>) => {
      const result = await call('translations.list', args)
      expect(result.isError).toBe(true)
      return jsonOf<{ kind: string; message: string }>(result)
    }
    expect(await error({ locale: 'en' })).toMatchObject({
      kind: 'input',
      message: expect.stringMatching(/en is the primary language/),
    })
    expect((await error({ locale: 'it' })).message).toBe('unknown language it')
    expect((await error({ locale: 'de', page: 'p-nope' })).message).toBe('unknown page p-nope')
    expect((await error({ locale: 'de', cursor: 'x' })).message).toMatch(/unknown cursor/)
  })
})

describe('translations.apply', () => {
  it('translates a page in one batch, live, and counts what remains', async () => {
    const { call, store, applied } = await start()
    const listed = jsonOf<Listed>(await call('translations.list', { locale: 'de', page: 'p-home' }))
    expect(listed.items.length).toBeGreaterThan(0)
    const before = jsonOf<Listed>(await call('translations.list', { locale: 'de', limit: 500 }))
    const result = jsonOf<{ revision: number; applied: number; remaining: number }>(
      await call('translations.apply', {
        locale: 'de',
        expectedRevision: listed.revision,
        items: listed.items.map((item) => ({ key: item.key, value: translate(item) })),
      }),
    )
    expect(result).toMatchObject({ revision: 1, applied: listed.items.length })
    expect(result.remaining).toBe(before.items.length - listed.items.length)
    expect(result).not.toHaveProperty('patches')
    expect(applied).toHaveLength(1)
    const doc = store.read().document
    expect(translationProgress(doc, 'de', 'p-home')).toMatchObject({ missing: 0, outdated: 0 })
    const hero = doc.translations.de!['node:n-hero-title.text']!.value
    expect(plainText(hero)).toBe('Gestalten. Veröffentlichen. Besitzen.')
  })

  it('reports a stale revision and an invalid value by item index, writing nothing', async () => {
    const { call, store } = await start()
    const stale = await call('translations.apply', {
      locale: 'de',
      expectedRevision: 3,
      items: [{ key: 'page:p-post.name', value: 'Beitrag' }],
    })
    expect(jsonOf(stale)).toMatchObject({ kind: 'stale', expected: 3, current: 0 })
    const invalid = await call('translations.apply', {
      locale: 'de',
      expectedRevision: 0,
      items: [
        { key: 'page:p-post.name', value: 'Beitrag' },
        { key: 'page:p-post.path', value: 'Kein Slug' },
      ],
    })
    expect(invalid.isError).toBe(true)
    expect(jsonOf(invalid)).toMatchObject({ kind: 'operation', index: 1, type: 'translation.set' })
    const primary = await call('translations.apply', {
      locale: 'en',
      expectedRevision: 0,
      items: [{ key: 'page:p-post.name', value: 'Post' }],
    })
    expect(jsonOf(primary)).toMatchObject({ kind: 'input' })
    expect(store.read().revision).toBe(0)
    const dry = jsonOf<{ revision: number; applied: number; remaining: number }>(
      await call('translations.apply', {
        locale: 'de',
        expectedRevision: 0,
        dryRun: true,
        items: [{ key: 'page:p-post.name', value: 'Beitrag' }],
      }),
    )
    const all = jsonOf<Listed>(await call('translations.list', { locale: 'de', limit: 500 }))
    expect(dry).toMatchObject({ revision: 0, applied: 1, remaining: all.items.length - 1 })
    expect(store.read().document.translations.de!['page:p-post.name']).toBeUndefined()
  })
})
