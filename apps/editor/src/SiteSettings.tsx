import type { Operation } from '@lacuno/document'
import { type Document, type GlossaryTerm, languageName, siteLocales } from '@lacuno/schema'
import { useState } from 'react'
import { CodeField } from './CodeField.js'
import { Dialog, ErrorNote } from './Dialog.js'
import { FontSettings } from './FontSettings.js'
import { ImageLibrary } from './ImageLibrary.js'
import { Menu, type MenuPoint, menuPoint } from './Menu.js'
import { langError, redirectError, siteUrlError } from './pages.js'

export const codeInfo = (where: string) =>
  `Code such as analytics, verification tags or chat widgets. It is published exactly as written at the end of the ${where} on every page it applies to, and it does not run on the canvas.`

/** An asset picked from the image library, with its name, Choose and Remove. */
export function ImageChoice({
  label,
  siteId,
  doc,
  value,
  disabled = false,
  choose,
}: {
  label: string
  siteId: string
  doc: Document
  value: string
  disabled?: boolean
  choose: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="image-choice">
      <span>{label}</span>
      <strong>{doc.assets[value]?.name ?? 'None'}</strong>
      <button
        type="button"
        aria-label={`Choose ${label.toLowerCase()}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Choose
      </button>
      {value && (
        <button
          type="button"
          aria-label={`Remove ${label.toLowerCase()}`}
          disabled={disabled}
          onClick={() => choose('')}
        >
          Remove
        </button>
      )}
      {open && (
        <ImageLibrary
          siteId={siteId}
          doc={doc}
          selected={value}
          close={() => setOpen(false)}
          choose={(id) => {
            setOpen(false)
            choose(id)
          }}
        />
      )}
    </div>
  )
}

type SiteField = 'name' | 'url' | 'locale' | 'titleTemplate' | 'headCode' | 'bodyCode'

const COMMON_LANGUAGES =
  'en de fr es it pt nl pl sv da fi nb cs sk hu ro hr sl el tr ru uk ja zh ko ar he hi'

/**
 * The site's other languages after the primary: label, draft, tone, order, removal, and adding
 * one; with an auto-translate service, whether it keeps each in sync. A site in one language
 * shows only the Add row.
 */
function Languages({
  doc,
  keepInSync,
  write,
}: {
  doc: Document
  keepInSync: boolean
  write: (key: string, operations: Operation[]) => Promise<boolean>
}) {
  const locales = siteLocales(doc)
  const codes = locales.map((l) => l.code)
  const [code, setCode] = useState('')
  const [issue, setIssue] = useState('')
  const [menu, setMenu] = useState<{ index: number; at: MenuPoint }>()
  const move = (from: number, to: number) => {
    const order = [...codes]
    order.splice(to, 0, ...order.splice(from, 1))
    void write('languages', [{ type: 'locale.reorder', codes: order }])
  }
  const update = (
    code: string,
    change: Omit<Extract<Operation, { type: 'locale.update' }>, 'type' | 'code'>,
  ) => void write('languages', [{ type: 'locale.update', code, ...change }])
  const remove = (index: number) => {
    const { code } = locales[index]!
    const count = Object.keys(doc.translations[code] ?? {}).length
    if (
      window.confirm(
        `Remove ${languageName(code)}? ${count === 1 ? 'Its 1 translation goes' : `Its ${count} translations go`} with it.`,
      )
    )
      void write('languages', [{ type: 'locale.remove', code }])
  }
  return (
    <>
      {locales.length > 1 && <h3>Languages</h3>}
      {locales.length > 1 && (
        <ul className="language-list" aria-label="Languages">
          {locales.map((locale, index) => (
            <li key={locale.code}>
              <strong className="language-code">{locale.code}</strong>
              <input
                aria-label={`Name of ${locale.code}`}
                placeholder={languageName(locale.code)}
                defaultValue={locale.label ?? ''}
                onBlur={(event) => {
                  const label = event.target.value.trim()
                  if (label !== (locale.label ?? '')) update(locale.code, { label: label || null })
                }}
              />
              {index === 0 ? (
                <em>Primary</em>
              ) : (
                <span className="language-options">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={!!locale.draft}
                      onChange={(event) => update(locale.code, { draft: event.target.checked })}
                    />
                    Draft
                  </label>
                  <select
                    aria-label={`Tone of ${locale.code}`}
                    value={locale.tone ?? ''}
                    onChange={(event) =>
                      update(locale.code, {
                        tone: (event.target.value || null) as 'formal' | 'informal' | null,
                      })
                    }
                  >
                    <option value="">Any tone</option>
                    <option value="formal">Formal</option>
                    <option value="informal">Informal</option>
                  </select>
                  {keepInSync && (
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={!!locale.autoTranslate}
                        onChange={(event) =>
                          update(locale.code, { autoTranslate: event.target.checked })
                        }
                      />
                      Keep in sync
                    </label>
                  )}
                </span>
              )}
              <button
                type="button"
                className="page-settings-trigger"
                aria-label={`Actions for ${locale.code}`}
                aria-haspopup="menu"
                aria-expanded={menu?.index === index}
                onClick={(event) => setMenu({ index, at: menuPoint(event) })}
              >
                •••
              </button>
            </li>
          ))}
        </ul>
      )}
      {menu && (
        <Menu
          at={menu.at}
          label="Language actions"
          close={() => setMenu(undefined)}
          items={[
            {
              label: 'Move up',
              disabled: menu.index === 0,
              run: () => move(menu.index, menu.index - 1),
            },
            {
              label: 'Move down',
              disabled: menu.index === locales.length - 1,
              run: () => move(menu.index, menu.index + 1),
            },
            {
              label: 'Remove',
              danger: true,
              disabled: menu.index === 0,
              run: () => remove(menu.index),
            },
          ]}
        />
      )}
      <form
        className="language-form"
        onSubmit={async (event) => {
          event.preventDefault()
          const next = code.trim()
          const problem = !next
            ? 'Enter a language code such as en or de-AT.'
            : codes.includes(next)
              ? 'The site already has this language.'
              : langError(next)
          setIssue(problem)
          if (!problem && (await write('languages', [{ type: 'locale.add', code: next }])))
            setCode('')
        }}
      >
        <input
          aria-label="Language code"
          placeholder="Language code, such as de or fr-CA"
          list="language-codes"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
        <datalist id="language-codes">
          {COMMON_LANGUAGES.split(' ').map((c) => (
            <option key={c} value={c}>
              {languageName(c)}
            </option>
          ))}
        </datalist>
        <button type="submit">Add language</button>
      </form>
      <ErrorNote message={issue} />
    </>
  )
}

/**
 * Terms translated the same way everywhere: per term, its translation into each other language;
 * a term left untranslated stays as it is in every language.
 */
function Glossary({
  doc,
  write,
}: {
  doc: Document
  write: (key: string, operations: Operation[]) => Promise<boolean>
}) {
  const terms = doc.site.glossary ?? []
  const others = siteLocales(doc).slice(1)
  const [term, setTerm] = useState('')
  const save = (next: GlossaryTerm[]) => write('glossary', [{ type: 'glossary.set', terms: next }])
  const change = (index: number, value: GlossaryTerm) =>
    void save(terms.map((t, i) => (i === index ? value : t)))
  return (
    <>
      <h3>Glossary</h3>
      {terms.length > 0 && (
        <table className="glossary" aria-label="Glossary">
          <thead>
            <tr>
              <th>Term</th>
              {others.map(({ code }) => (
                <th key={code}>{languageName(code)}</th>
              ))}
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {terms.map((item, index) => (
              <tr key={item.term}>
                <td>
                  <input
                    aria-label="Term"
                    defaultValue={item.term}
                    onBlur={(event) => {
                      const next = event.target.value.trim()
                      if (!next) event.target.value = item.term
                      else if (next !== item.term) change(index, { ...item, term: next })
                    }}
                  />
                </td>
                {others.map(({ code }) => (
                  <td key={code}>
                    <input
                      aria-label={`${item.term} in ${code}`}
                      placeholder={item.term}
                      defaultValue={item.translations?.[code] ?? ''}
                      onBlur={(event) => {
                        const value = event.target.value.trim()
                        if (value === (item.translations?.[code] ?? '')) return
                        const { [code]: _old, ...rest } = item.translations ?? {}
                        const translations = value ? { ...rest, [code]: value } : rest
                        const { translations: _all, ...base } = item
                        change(
                          index,
                          Object.keys(translations).length ? { ...base, translations } : base,
                        )
                      }}
                    />
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="glossary-remove"
                    aria-label={`Remove ${item.term}`}
                    onClick={() => void save(terms.filter((_, i) => i !== index))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form
        className="language-form"
        onSubmit={async (event) => {
          event.preventDefault()
          const next = term.trim()
          if (next && (await save([...terms, { term: next }]))) setTerm('')
        }}
      >
        <input
          aria-label="New term"
          placeholder="Brand or term"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <button type="submit">Add term</button>
      </form>
    </>
  )
}

export function SiteSettings({
  doc,
  siteId,
  keepInSync,
  close,
  autoSave,
}: {
  doc: Document
  siteId: string
  /** Whether an auto-translate service can keep languages in sync. */
  keepInSync: boolean
  close: () => void
  autoSave: (operations: Operation[]) => Promise<boolean>
}) {
  const { site } = doc
  const [form, setForm] = useState<Record<SiteField, string>>({
    name: site.name,
    url: site.url ?? '',
    locale: site.locale,
    titleTemplate: site.titleTemplate ?? '',
    headCode: site.headCode ?? '',
    bodyCode: site.bodyCode ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [redirect, setRedirect] = useState({ from: '', to: '' })
  const failed = 'Could not save. Check the editor message and try again.'
  const write = async (key: string, operations: Operation[]) => {
    const ok = await autoSave(operations)
    setErrors((current) => ({ ...current, [key]: ok ? '' : failed }))
    return ok
  }
  const change = (key: SiteField) => (value: string) => setForm({ ...form, [key]: value })
  const commit = (key: SiteField, issue = '') => {
    const value = key.endsWith('Code') ? form[key] : form[key].trim()
    setErrors({ ...errors, [key]: issue })
    if (issue || value === (site[key] ?? '')) return
    // A site that once had more languages keeps its one in `locales`: that one is replaced.
    if (key === 'locale' && site.locales)
      void write(key, [
        { type: 'locale.add', code: value },
        { type: 'locale.reorder', codes: [value, site.locale] },
        { type: 'locale.remove', code: site.locale },
      ])
    else void write(key, [{ type: 'site.update', [key]: value || null } as Operation])
  }
  const field = (key: SiteField, label: string, issue: () => string, placeholder?: string) => (
    <>
      <label>
        {label}
        <input
          value={form[key]}
          placeholder={placeholder}
          onChange={(event) => change(key)(event.target.value)}
          onBlur={() => commit(key, issue())}
        />
      </label>
      <ErrorNote message={errors[key] ?? ''} />
    </>
  )
  return (
    <Dialog title="Site settings" className="site-settings-dialog" close={close}>
      {field('name', 'Site name', () => (form.name.trim() ? '' : 'Enter a site name.'))}
      {field('url', 'Public URL', () => siteUrlError(form.url.trim()), 'https://example.com')}
      <p className="hint">
        The address visitors use, such as your own domain. It drives the canonical link, social
        sharing URLs and the sitemap, and overrides the server's published address.
      </p>
      {siteLocales(doc).length === 1 &&
        field(
          'locale',
          'Language',
          () =>
            form.locale.trim()
              ? langError(form.locale.trim())
              : 'Enter a language code such as en or de-AT.',
          'en',
        )}
      <Languages doc={doc} keepInSync={keepInSync} write={write} />
      <ErrorNote message={errors.languages ?? ''} />
      {siteLocales(doc).length > 1 && <Glossary doc={doc} write={write} />}
      <ErrorNote message={errors.glossary ?? ''} />
      {field(
        'titleTemplate',
        'Title template',
        () =>
          !form.titleTemplate.trim() || form.titleTemplate.includes('{page}')
            ? ''
            : 'Put {page} where each page’s title goes.',
        `{page} — ${site.name}`,
      )}
      <ImageChoice
        label="Favicon"
        siteId={siteId}
        doc={doc}
        value={site.favicon ?? ''}
        choose={(id) => void write('favicon', [{ type: 'site.update', favicon: id || null }])}
      />
      <p className="hint">A square PNG or SVG works best.</p>
      <ErrorNote message={errors.favicon ?? ''} />
      {(['headCode', 'bodyCode'] as const).map((key) => (
        <CodeField
          key={key}
          label={key === 'headCode' ? 'Head code' : 'Body code'}
          info={codeInfo(key === 'headCode' ? 'head' : 'body')}
          value={form[key]}
          change={change(key)}
          commit={() => commit(key)}
        />
      ))}
      <ErrorNote message={errors.headCode || errors.bodyCode || ''} />
      <FontSettings doc={doc} siteId={siteId} write={write} />
      <ErrorNote message={errors.fonts ?? ''} />
      <h3>Redirects</h3>
      <ul className="redirect-list">
        {doc.redirects.map((r) => (
          <li key={r.from}>
            <span>
              {r.from} → {r.to}
            </span>
            <button
              type="button"
              aria-label={`Remove redirect from ${r.from}`}
              onClick={() => void write('redirect', [{ type: 'redirect.remove', from: r.from }])}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form
        className="redirect-form"
        onSubmit={async (event) => {
          event.preventDefault()
          const next = { ...redirect, from: redirect.from.trim(), to: redirect.to.trim() }
          const issue = redirectError(doc, next.from, next.to)
          setErrors({ ...errors, redirect: issue })
          if (!issue && (await write('redirect', [{ type: 'redirect.add', ...next }])))
            setRedirect({ from: '', to: '' })
        }}
      >
        <input
          aria-label="Redirect from"
          placeholder="/old-page"
          value={redirect.from}
          onChange={(event) => setRedirect({ ...redirect, from: event.target.value })}
        />
        <input
          aria-label="Redirect to"
          placeholder="/new-page"
          value={redirect.to}
          onChange={(event) => setRedirect({ ...redirect, to: event.target.value })}
        />
        <button type="submit">Add</button>
      </form>
      <ErrorNote message={errors.redirect ?? ''} />
    </Dialog>
  )
}
