import type { Operation } from '@lacuno/document'
import {
  type Binding,
  type Document,
  findEntry,
  languageName,
  localize,
  plainText,
  type RichText,
  siteLocales,
  sourceHash,
  TRANSLATABLE_ATTRS,
  type TranslationProgress,
  translationSource,
} from '@lacuno/schema'

/** The one line shown where the layout cannot change, naming the primary's language: en-US is English. */
export function layoutLocked(doc: Document): string {
  const primary = siteLocales(doc)[0]!
  const base = primary.code.split('-')[0]!
  return `Change the layout in ${languageName(base, primary.label)}`
}

/** Equal values read the same, and a cleared value (null) is no value. */
const same = (a: unknown, b: unknown) => sourceHash(a ?? undefined) === sourceHash(b ?? undefined)

/** A text or attribute as a translation holds it: the static value, or the rich text itself. */
function translated(value: RichText | Binding | undefined): unknown {
  if (value === undefined || value.type === 'doc') return value
  return value.type === 'static' ? value.value : value
}

/**
 * The operations the panels made against the document as `locale` shows it, as that language's
 * translations. Language operations pass; anything else that changes, the layout, a class or a
 * value that does not translate, throws `layoutLocked`. A value set back to the primary's, or
 * cleared, removes its translation so the language falls back to the primary again.
 */
export function toTranslations(doc: Document, locale: string, operations: Operation[]) {
  const shown = localize(doc, locale)
  const refuse = (): never => {
    throw new Error(layoutLocked(doc))
  }
  const out: Operation[] = []
  const set = (key: string, before: unknown, after: unknown) => {
    if (same(before, after)) return
    const source = translationSource(doc, key)
    if (!source) refuse()
    const existing = doc.translations[locale]?.[key]
    if (after === undefined || after === null || after === '' || same(after, source?.value)) {
      if (existing) out.push({ type: 'translation.delete', locale, key })
    } else out.push({ type: 'translation.set', locale, key, value: after })
  }
  // Fields the language shares with the primary must stay as they are shown.
  const unchanged = (before: object, after: object) => {
    for (const [name, value] of Object.entries(after))
      if (!same((before as Record<string, unknown>)[name], value)) refuse()
  }
  const each = <T>(before: Record<string, T> | undefined, after: Record<string, T>) =>
    [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].map(
      (name) => [name, before?.[name], after[name]] as const,
    )
  for (const op of operations) {
    switch (op.type) {
      case 'locale.add':
      case 'locale.update':
      case 'locale.remove':
      case 'locale.reorder':
      case 'translation.set':
      case 'translation.delete':
        out.push(op)
        break
      case 'node.update': {
        const { type: _type, id, text, attrs, props, ...rest } = op
        const node = shown.nodes[id] ?? refuse()
        unchanged(node, rest)
        if (text !== undefined && node.type === 'text') {
          // A plain text stays plain: the canvas's editor hands back rich text for it.
          const plain = node.text.type === 'static' && text.type === 'doc'
          set(`node:${id}.text`, translated(node.text), plain ? plainText(text) : translated(text))
        } else if (text !== undefined) refuse()
        if (attrs === null || props === null) refuse()
        for (const [name, before, after] of each(node.attrs, attrs ?? node.attrs ?? {})) {
          if (same(before, after)) continue
          if (!TRANSLATABLE_ATTRS.includes(name)) refuse()
          set(`node:${id}.attr.${name}`, translated(before), translated(after))
        }
        const shownProps = node.type === 'component' ? node.props : undefined
        for (const [name, before, after] of each(shownProps, props ?? shownProps ?? {}))
          set(`node:${id}.prop.${name}`, translated(before), translated(after))
        break
      }
      case 'page.update': {
        const { type: _type, id, name, path, seo, ...rest } = op
        const page = shown.pages[id] ?? refuse()
        unchanged(page, rest)
        if (name !== undefined) set(`page:${id}.name`, page.name, name)
        if (path !== undefined && path !== page.path) {
          // Only the last segment is the language's own; the rest follows the primary.
          const segment = /[a-z0-9-]+$/
          if (path.replace(segment, '') !== page.path.replace(segment, '')) refuse()
          set(`page:${id}.path`, segment.exec(page.path)?.[0], segment.exec(path)?.[0])
        }
        if (seo !== undefined) {
          const { title, description, ogImage, ...other } = seo ?? {}
          const { title: _t, description: _d, ogImage: _o, ...shownOther } = page.seo ?? {}
          unchanged(shownOther, other)
          unchanged(other, shownOther)
          set(`page:${id}.seo.title`, page.seo?.title, title)
          set(`page:${id}.seo.description`, page.seo?.description, description)
          set(`page:${id}.seo.ogImage`, page.seo?.ogImage, ogImage)
        }
        break
      }
      case 'entry.update': {
        const entry = findEntry(shown, op.id)?.entry ?? refuse()
        for (const [field, value] of Object.entries(op.fields))
          set(`entry:${op.id}.${field}`, entry.fields[field], value)
        break
      }
      case 'site.update': {
        const { type: _type, titleTemplate, ...rest } = op
        unchanged(shown.site, rest)
        if (titleTemplate !== undefined)
          set('site.titleTemplate', shown.site.titleTemplate, titleTemplate)
        break
      }
      default:
        refuse()
    }
  }
  return out
}

/** How much of a language is done, in whole percent; nothing to translate is all done. */
export function percentDone({ done, outdated, missing }: TranslationProgress): number {
  const total = done + outdated + missing
  return total ? Math.floor((done / total) * 100) : 100
}
