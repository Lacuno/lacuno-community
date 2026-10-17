import {
  type Document,
  findEntry,
  languageName,
  plainText,
  type RichText,
  siteLocales,
  type TranslationItem,
  translationKeys,
  translationProgress,
  translationStatus,
} from '@lacuno/schema'
import { lazy, Suspense, useRef, useState } from 'react'
import { entryTitle } from './cms.js'
import { ImageChoice } from './SiteSettings.js'
import type { DocumentSession } from './session.js'
import { nodeLabel } from './structure.js'

const RichTextField = lazy(() =>
  import('./RichTextField.js').then((module) => ({ default: module.RichTextField })),
)

const PAGE_PARTS: Record<string, string> = {
  name: 'Page name',
  path: 'Path',
  'seo.title': 'SEO title',
  'seo.description': 'SEO description',
  'seo.ogImage': 'Social image',
}

/** The heading a value is listed under: the site, its page, its component or its collection. */
function group(doc: Document, { context }: TranslationItem): string {
  if (context.type === 'site') return 'Site'
  if (context.type === 'page') return doc.pages[context.page]?.name ?? 'Page'
  if (context.type === 'component')
    return `${doc.components[context.component]?.name ?? 'Component'} component`
  return doc.collections[context.collection]?.name ?? 'Collection'
}

/** What a value is, in its group: the element and attribute, the page field or the entry field. */
function label(doc: Document, { key, context }: TranslationItem): string {
  if (context.type === 'site') return 'Title template'
  if (context.type === 'entry') {
    const found = findEntry(doc, context.entry)
    const field = found?.collection.fields.find((f) => f.id === context.field)
    return `${found ? entryTitle(found.collection, found.entry) : 'Entry'} · ${field?.label ?? ''}`
  }
  if (!context.node) return PAGE_PARTS[key.slice(key.indexOf('.') + 1)] ?? key
  const node = doc.nodes[context.node]
  const part = /\.(?:attr|prop)\.(.+)$/.exec(key)?.[1]
  return `${node ? nodeLabel(node) : 'Element'}${part ? ` · ${part}` : ''}`
}

const preview = (doc: Document, item: TranslationItem) =>
  item.kind === 'richtext'
    ? plainText(item.value)
    : item.kind === 'asset'
      ? (doc.assets[item.value as string]?.name ?? '')
      : String(item.value)

/** One value's translation, saved when its field is left; an empty one falls back to the primary. */
function TranslationField({
  siteId,
  doc,
  item,
  value,
  disabled,
  write,
}: {
  siteId: string
  doc: Document
  item: TranslationItem
  value: unknown
  disabled: boolean
  write: (value: unknown) => void
}) {
  const draft = useRef(value)
  if (item.kind === 'asset')
    return (
      <ImageChoice
        label="Translation"
        siteId={siteId}
        doc={doc}
        value={(value as string | undefined) ?? ''}
        disabled={disabled}
        choose={(id) => write(id)}
      />
    )
  if (item.kind === 'richtext')
    return (
      <fieldset
        className="translation-rich"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) write(draft.current)
        }}
      >
        <Suspense fallback={<p className="hint">Opening text editor…</p>}>
          <RichTextField
            label="Translation"
            value={value as RichText | undefined}
            disabled={disabled}
            change={(next) => {
              draft.current = next
            }}
          />
        </Suspense>
      </fieldset>
    )
  return (
    <input
      aria-label="Translation"
      defaultValue={(value as string | undefined) ?? ''}
      disabled={disabled}
      onBlur={(event) => write(event.target.value.trim())}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

/** Every value of the site beside its translation in one language, to translate in one place. */
export function TranslationsPanel({
  siteId,
  session,
  open,
}: {
  siteId: string
  session: DocumentSession
  /** Shows an element of a page in a language. */
  open: (locale: string, page: string, node: string) => void
}) {
  const source = session.snapshot?.document
  const others = source ? siteLocales(source).slice(1) : []
  const [chosen, setChosen] = useState('')
  const [filter, setFilter] = useState<'all' | 'missing' | 'outdated'>('all')
  const locale =
    [chosen, session.translating ? session.locale : ''].find((code) =>
      others.some((l) => l.code === code),
    ) ?? others[0]?.code
  if (!source || !locale) return null
  const translations = source.translations[locale] ?? {}
  const progress = translationProgress(source, locale)
  const disabled = session.frozen
  const write = (key: string, value: unknown) => {
    const current = translations[key]?.value
    if (JSON.stringify(value) === JSON.stringify(current) || (value === '' && !current)) return
    void session.save([
      value === '' || value === undefined
        ? { type: 'translation.delete', locale, key }
        : { type: 'translation.set', locale, key, value },
    ])
  }
  const groups = new Map<string, TranslationItem[]>()
  for (const item of translationKeys(source)) {
    const status = translationStatus(source, locale, item.key)
    if (filter !== 'all' && status !== filter) continue
    const name = group(source, item)
    groups.set(name, [...(groups.get(name) ?? []), item])
  }
  return (
    <>
      <div className="panel-title">Translations</div>
      <div className="translations-toolbar">
        <select
          aria-label="Translation language"
          value={locale}
          onChange={(event) => setChosen(event.target.value)}
        >
          {others.map((l) => (
            <option key={l.code} value={l.code}>
              {languageName(l.code, l.label)}
            </option>
          ))}
        </select>
        <select
          aria-label="Show"
          value={filter}
          onChange={(event) => setFilter(event.target.value as typeof filter)}
        >
          <option value="all">All</option>
          <option value="missing">Missing</option>
          <option value="outdated">Outdated</option>
        </select>
        <p className="translations-counts" role="status">
          {progress.done} done · {progress.outdated} outdated · {progress.missing} missing
        </p>
      </div>
      <div className="translations-list">
        {[...groups].map(([name, items]) => (
          <section key={name} aria-label={name}>
            <h3>{name}</h3>
            {items.map((item) => {
              const { context } = item
              const status = translationStatus(source, locale, item.key)
              return (
                <div key={item.key} className="translation-row" data-status={status}>
                  {context.type === 'page' && context.node ? (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => open(locale, context.page, context.node!)}
                    >
                      {label(source, item)}
                    </button>
                  ) : (
                    <span>{label(source, item)}</span>
                  )}
                  <p className="translation-source">{preview(source, item)}</p>
                  <TranslationField
                    // A value saved or undone elsewhere starts the field over.
                    key={JSON.stringify(translations[item.key]?.value ?? null)}
                    siteId={siteId}
                    doc={source}
                    item={item}
                    value={translations[item.key]?.value}
                    disabled={disabled}
                    write={(value) => write(item.key, value)}
                  />
                  {status === 'outdated' && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={disabled}
                      aria-label={`Keep the translation of ${label(source, item)}`}
                      onClick={() =>
                        void session.save([
                          {
                            type: 'translation.set',
                            locale,
                            key: item.key,
                            value: translations[item.key]!.value,
                          },
                        ])
                      }
                    >
                      Keep
                    </button>
                  )}
                </div>
              )
            })}
          </section>
        ))}
      </div>
    </>
  )
}
