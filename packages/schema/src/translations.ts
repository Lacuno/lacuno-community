import { z } from 'zod'
import type { FieldDef } from './collections.js'
import { type Document, findEntry, primaryLocale, siteLocales } from './document.js'
import { AssetId } from './ids.js'
import { RichText } from './nodes.js'
import { TitleTemplate } from './pages.js'
import type { Issue } from './validate.js'

/**
 * Names one translatable value: `node:<id>.text`, `node:<id>.attr.<name>`, `node:<id>.prop.<prop>`,
 * `page:<id>.path`, `page:<id>.name`, `page:<id>.seo.title|description|ogImage`,
 * `entry:<id>.<fieldId>` or `site.titleTemplate`.
 */
export type TranslationKey = string

export type TranslationTarget =
  | { type: 'node'; id: string; part: 'text' }
  | { type: 'node'; id: string; part: 'attr' | 'prop'; name: string }
  | { type: 'page'; id: string; part: 'path' | 'name' | 'title' | 'description' | 'ogImage' }
  | { type: 'entry'; id: string; field: string }
  | { type: 'site' }

/** The attributes whose text is translated; a form's `data-success` is its message after sending. */
export const TRANSLATABLE_ATTRS = ['alt', 'title', 'placeholder', 'aria-label', 'data-success']

/** How an entry field's value is translated, for the field types that can be. */
const FIELD_KINDS: Partial<Record<FieldDef['type'], Kind>> = {
  text: 'string',
  richtext: 'richtext',
  slug: 'slug',
  link: 'string',
  image: 'asset',
  file: 'asset',
}

/** Text, rich text and slug fields translate unless they say otherwise; the rest only when they say so. */
export const isTranslatable = (field: FieldDef): boolean =>
  FIELD_KINDS[field.type] !== undefined &&
  (field.translatable ?? ['text', 'richtext', 'slug'].includes(field.type))

const ID = '([A-Za-z0-9_-]{1,64})'
const KEY = new RegExp(
  `^(?:node:${ID}\\.(?:(text)|(attr|prop)\\.([a-z][a-zA-Z0-9-]*))|page:${ID}\\.(path|name|seo\\.title|seo\\.description|seo\\.ogImage)|entry:${ID}\\.${ID}|(site\\.titleTemplate))$`,
)

export function parseKey(key: string): TranslationTarget | undefined {
  const m = KEY.exec(key)
  if (!m) return undefined
  const [, node, text, part, name, page, pagePart, entry, field, site] = m
  if (node && text) return { type: 'node', id: node, part: 'text' }
  if (node && name && (part === 'prop' || TRANSLATABLE_ATTRS.includes(name)))
    return { type: 'node', id: node, part: part as 'attr' | 'prop', name }
  if (page && pagePart)
    return { type: 'page', id: page, part: pagePart.replace('seo.', '') as 'path' }
  if (entry && field) return { type: 'entry', id: entry, field }
  if (site) return { type: 'site' }
}

type Kind = 'string' | 'richtext' | 'slug' | 'asset' | 'template'

const KIND_SCHEMA: Record<Kind, z.ZodType> = {
  string: z.string(),
  richtext: RichText,
  slug: z.string().regex(/^[a-z0-9-]+$/, 'a slug is lower-case letters, digits and dashes'),
  asset: AssetId,
  template: TitleTemplate,
}

/** A translatable value in a document: what kind it is, and reading and writing it in place. */
type Slot = { kind: Kind; get: () => unknown; set: (value: unknown) => void }

function slot(doc: Document, key: TranslationKey): Slot | undefined {
  const target = parseKey(key)
  switch (target?.type) {
    case 'node': {
      const node = doc.nodes[target.id]
      if (target.part === 'text') {
        if (node?.type !== 'text') return undefined
        const text = node.text
        if (text.type === 'doc')
          return { kind: 'richtext', get: () => text, set: (v) => (node.text = v as RichText) }
        if (text.type !== 'static' || typeof text.value !== 'string') return undefined
        return {
          kind: 'string',
          get: () => text.value,
          set: (v) => (node.text = { type: 'static', value: v as string }),
        }
      }
      const map = target.part === 'attr' ? node?.attrs : node?.type === 'component' && node.props
      const binding = map ? map[target.name] : undefined
      if (!map || binding?.type !== 'static' || typeof binding.value !== 'string') return undefined
      return {
        kind: 'string',
        get: () => binding.value,
        set: (v) => (map[target.name] = { type: 'static', value: v as string }),
      }
    }
    case 'page': {
      const page = doc.pages[target.id]
      if (!page) return undefined
      const { part } = target
      if (part === 'name')
        return { kind: 'string', get: () => page.name, set: (v) => (page.name = v as string) }
      if (part === 'path') {
        // Only a page's own last segment translates: not the home page's, nor a collection's [param].
        const last = /[a-z0-9-]+$/.exec(page.path)?.[0]
        if (!last) return undefined
        return {
          kind: 'slug',
          get: () => last,
          set: (v) => (page.path = page.path.replace(/[a-z0-9-]+$/, v as string)),
        }
      }
      return {
        kind: part === 'ogImage' ? 'asset' : 'string',
        get: () => page.seo?.[part],
        set: (v) => (page.seo = { ...page.seo, [part]: v }),
      }
    }
    case 'entry': {
      const found = findEntry(doc, target.id)
      const field = found?.collection.fields.find((f) => f.id === target.field)
      if (!found || !field || !isTranslatable(field)) return undefined
      return {
        kind: FIELD_KINDS[field.type]!,
        get: () => found.entry.fields[target.field],
        set: (v) => (found.entry.fields[target.field] = v),
      }
    }
    case 'site':
      return {
        kind: 'template',
        get: () => doc.site.titleTemplate,
        set: (v) => (doc.site.titleTemplate = v as string),
      }
  }
}

/** The primary language's value a key names, or undefined when there is nothing to translate. */
export function translationSource(
  doc: Document,
  key: TranslationKey,
): { value: unknown } | undefined {
  const target = slot(doc, key)
  return target && { value: target.get() }
}

/** Why `value` cannot be the translation of `key`, or undefined when it can. */
export function translationProblem(
  doc: Document,
  key: TranslationKey,
  value: unknown,
): string | undefined {
  const target = slot(doc, key)
  if (!target)
    return parseKey(key) ? `nothing to translate at ${key}` : `${key} is not a translation key`
  const result = KIND_SCHEMA[target.kind].safeParse(value)
  if (!result.success) return result.error.issues[0]?.message ?? 'invalid value'
  if (target.kind === 'asset' && !doc.assets[value as string]) return `unknown asset ${value}`
}

/** JSON with object keys sorted, so equal values always read the same. */
const stableJson = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(stableJson).join(',')}]`
    : typeof value === 'object' && value !== null
      ? `{${Object.entries(value)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
          .join(',')}}`
      : (JSON.stringify(value) ?? '')

/** A short hash of a value (FNV-1a), to tell when the primary value of a translation changed. */
export function sourceHash(value: unknown): string {
  const json = stableJson(value)
  let hash = 0x811c9dc5
  for (let i = 0; i < json.length; i++) hash = Math.imul(hash ^ json.charCodeAt(i), 0x01000193)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Whether a key has a translation in a language, and whether it was made from today's value. */
export function translationStatus(
  doc: Document,
  locale: string,
  key: TranslationKey,
): 'missing' | 'outdated' | 'done' {
  const translation = doc.translations[locale]?.[key]
  if (!translation) return 'missing'
  return translation.source === sourceHash(slot(doc, key)?.get()) ? 'done' : 'outdated'
}

const localized = new WeakMap<Document, Map<string, Document>>()

/**
 * The document as language `locale` shows it: its translations applied, its pages under
 * `/<code>`. The primary language is the document itself. Memoized per document and language,
 * so the document must not change afterwards.
 */
export function localize(doc: Document, locale: string): Document {
  if (locale === primaryLocale(doc)) return doc
  const byLocale = localized.get(doc) ?? new Map<string, Document>()
  localized.set(doc, byLocale)
  const local = byLocale.get(locale) ?? translate(doc, locale)
  byLocale.set(locale, local)
  return local
}

function translate(doc: Document, locale: string): Document {
  const local = structuredClone(doc)
  for (const [key, { value }] of Object.entries(local.translations[locale] ?? {}))
    slot(local, key)?.set(value)
  const prefix = `/${locale.toLowerCase()}`
  for (const page of Object.values(local.pages)) {
    page.path = page.path === '/' ? prefix : prefix + page.path
    page.lang = locale
    // A canonical set on the page points at the primary language's address.
    if (page.seo) delete page.seo.canonical
  }
  local.site.locale = locale
  return local
}

/**
 * Translations in unknown languages, keys that don't parse, values of the wrong kind, and paths
 * or slugs that collide inside one language. Translations of values that no longer exist are
 * left alone: removals clean them up, and `localize` skips them.
 */
export function checkTranslations(doc: Document): Issue[] {
  const issues: Issue[] = []
  const locales = siteLocales(doc)
  const codes = new Set(locales.map((l) => l.code))
  for (const [locale, keys] of Object.entries(doc.translations)) {
    if (!codes.has(locale))
      issues.push({ path: `translations.${locale}`, message: `unknown language ${locale}` })
    for (const [key, { value }] of Object.entries(keys)) {
      const problem = parseKey(key)
        ? slot(doc, key) && translationProblem(doc, key, value)
        : `${key} is not a translation key`
      if (problem) issues.push({ path: `translations.${locale}.${key}`, message: problem })
    }
  }
  if (issues.length) return issues
  const prefixes = new Map(locales.slice(1).map((l) => [l.code.toLowerCase(), l.code]))
  for (const page of Object.values(doc.pages)) {
    const code = prefixes.get(page.path.split('/')[1] ?? '')
    if (code)
      issues.push({
        path: `pages.${page.id}`,
        message: `path ${page.path} is the address of language ${code}`,
      })
  }
  for (const { code } of locales.slice(1)) {
    const local = localize(doc, code)
    const add = (message: string) => issues.push({ path: `translations.${code}`, message })
    const paths = new Map<string, string>()
    for (const page of Object.values(local.pages)) {
      const other = paths.get(page.path)
      if (other) add(`path ${page.path} is used by pages ${other} and ${page.id}`)
      paths.set(page.path, page.id)
    }
    for (const col of Object.values(local.collections)) {
      const slugs = new Map<unknown, string>()
      for (const entry of local.entries[col.id] ?? []) {
        const slug = entry.fields[col.slugField]
        const other = slugs.get(slug)
        if (other) add(`slug ${slug} is used by entries ${other} and ${entry.id}`)
        slugs.set(slug, entry.id)
      }
    }
  }
  return issues
}
