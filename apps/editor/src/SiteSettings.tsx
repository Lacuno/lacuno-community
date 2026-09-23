import type { Operation } from '@freeflow/document'
import type { Document } from '@freeflow/schema'
import { useState } from 'react'
import { CodeField } from './CodeField.js'
import { Dialog, ErrorNote } from './Dialog.js'
import { FontSettings } from './FontSettings.js'
import { ImageLibrary } from './ImageLibrary.js'
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

type SiteField = 'name' | 'url' | 'locale' | 'headCode' | 'bodyCode'

export function SiteSettings({
  doc,
  siteId,
  close,
  autoSave,
}: {
  doc: Document
  siteId: string
  close: () => void
  autoSave: (operations: Operation[]) => Promise<boolean>
}) {
  const { site } = doc
  const [form, setForm] = useState<Record<SiteField, string>>({
    name: site.name,
    url: site.url ?? '',
    locale: site.locale,
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
    void write(key, [{ type: 'site.update', [key]: value || null } as Operation])
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
      {field(
        'locale',
        'Language',
        () =>
          form.locale.trim()
            ? langError(form.locale.trim())
            : 'Enter a language code such as en or de-AT.',
        'en',
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
