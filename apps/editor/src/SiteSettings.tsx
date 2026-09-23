import type { Operation } from '@freeflow/document'
import type { Document, Font, Redirect } from '@freeflow/schema'
import { type ReactNode, useId, useRef, useState } from 'react'
import { uploadAsset } from './AssetsPanel.js'
import { message } from './api.js'
import { Dialog, ErrorNote } from './Dialog.js'
import { EditorIcon } from './EditorIcon.js'
import { faceFromFileName, faceLabel, setFallback, WEIGHT_NAMES } from './fonts.js'
import { ImageLibrary } from './ImageLibrary.js'
import { redirectError, siteUrlError } from './pages.js'
import { placePopover } from './popover.js'

/** A monospace code field with the embed field's info popover. */
export function CodeField({
  label,
  info,
  value,
  disabled = false,
  change,
  commit,
}: {
  label: string
  info: ReactNode
  value: string
  disabled?: boolean
  change: (value: string) => void
  commit?: () => void
}) {
  const id = useId()
  const popover = useRef<HTMLDivElement>(null)
  return (
    <div className="embed-section">
      <div className="embed-heading">
        <span>{label}</span>
        <button
          type="button"
          className="scope-info-button"
          aria-label={`About ${label.toLowerCase()}`}
          popoverTarget={id}
          onClick={(event) => placePopover(event.currentTarget, popover.current)}
        >
          <EditorIcon name="info" />
        </button>
        <div ref={popover} id={id} popover="auto" className="scope-info-popover">
          {info}
        </div>
      </div>
      <textarea
        aria-label={label}
        className="embed-code"
        rows={4}
        value={value}
        disabled={disabled}
        onChange={(event) => change(event.target.value)}
        onBlur={commit}
      />
    </div>
  )
}

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

/**
 * The site's font faces grouped by family, each face removable and the fallback saved on blur,
 * plus the forms that add an uploaded face or a system font. Every change writes the whole list.
 */
function FontSettings({
  doc,
  siteId,
  write,
}: {
  doc: Document
  siteId: string
  write: (key: string, operations: Operation[]) => Promise<boolean>
}) {
  const { fonts } = doc.site
  const [face, setFace] = useState<Font | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const save = (next: Font[]) => write('fonts', [{ type: 'site.update', fonts: next }])
  const fallbackOf = (family: string) =>
    fonts.find((f) => f.family === family)?.fallback ?? 'sans-serif'
  return (
    <>
      <h3>Fonts</h3>
      <ul className="font-list">
        {[...new Set(fonts.map((f) => f.family))].map((family) => (
          <li key={family}>
            <strong>{family}</strong>
            <span className="font-faces">
              {fonts.map(
                (font, index) =>
                  font.family === family && (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a face has no id; its place is its identity
                    <span key={index} className="font-face">
                      {faceLabel(font)}
                      {font.source === 'asset' && !doc.assets[font.asset ?? ''] && (
                        <em>File missing</em>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${family} ${faceLabel(font)}`}
                        onClick={() => void save(fonts.filter((_, i) => i !== index))}
                      >
                        ×
                      </button>
                    </span>
                  ),
              )}
            </span>
            <input
              key={fallbackOf(family)}
              aria-label={`${family} fallback`}
              defaultValue={fallbackOf(family)}
              onBlur={(event) => {
                const fallback = event.target.value.trim()
                if (fallback !== fallbackOf(family)) void save(setFallback(fonts, family, fallback))
              }}
            />
          </li>
        ))}
      </ul>
      {face ? (
        <form
          className="font-form"
          onSubmit={async (event) => {
            event.preventDefault()
            const added = {
              ...face,
              family: face.family.trim(),
              fallback: face.fallback?.trim() || undefined,
            }
            if (await save([...fonts, added])) setFace(null)
          }}
        >
          <label>
            Family
            <input
              required
              value={face.family}
              onChange={(event) => setFace({ ...face, family: event.target.value })}
            />
          </label>
          {face.source === 'asset' && (
            <>
              <label>
                Weight
                <select
                  aria-label="Weight"
                  value={face.weight}
                  onChange={(event) => setFace({ ...face, weight: Number(event.target.value) })}
                >
                  {WEIGHT_NAMES.map((name, i) => (
                    <option key={name} value={(i + 1) * 100}>
                      {(i + 1) * 100} {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Style
                <select
                  aria-label="Style"
                  value={face.style}
                  onChange={(event) =>
                    setFace({ ...face, style: event.target.value as Font['style'] })
                  }
                >
                  <option value="normal">Regular</option>
                  <option value="italic">Italic</option>
                </select>
              </label>
            </>
          )}
          <label>
            Fallback
            <input
              value={face.fallback ?? ''}
              onChange={(event) => setFace({ ...face, fallback: event.target.value })}
            />
          </label>
          <button type="submit">Add</button>
          <button type="button" onClick={() => setFace(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="font-actions">
          <label className="asset-upload">
            Add font
            <input
              aria-label="Upload font"
              type="file"
              accept="font/woff2,font/woff,font/ttf,font/otf,.woff2,.woff,.ttf,.otf"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                setError('')
                setUploading(true)
                try {
                  const asset = await uploadAsset(siteId, file)
                  if (asset.kind !== 'font')
                    throw new Error('Choose a WOFF2, WOFF, TTF or OTF font.')
                  if (
                    doc.assets[asset.id] ||
                    (await write('fonts', [{ type: 'asset.create', ...asset }]))
                  ) {
                    const prefill = faceFromFileName(file.name)
                    setFace({
                      source: 'asset',
                      asset: asset.id,
                      ...prefill,
                      fallback: fallbackOf(prefill.family),
                    })
                  }
                } catch (err) {
                  setError(message(err, 'Could not upload the font.'))
                } finally {
                  setUploading(false)
                }
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => setFace({ family: '', source: 'system', fallback: 'sans-serif' })}
          >
            Add system font
          </button>
        </div>
      )}
      {uploading && <p role="status">Uploading font…</p>}
      <ErrorNote message={error} />
    </>
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
  const [redirect, setRedirect] = useState<Redirect>({ from: '', to: '', status: 301 })
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
        () => (form.locale.trim() ? '' : 'Enter a language code such as en or de.'),
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
              {r.from} → {r.to} · {r.status}
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
            setRedirect({ from: '', to: '', status: 301 })
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
        <select
          aria-label="Redirect status"
          value={redirect.status}
          onChange={(event) =>
            setRedirect({ ...redirect, status: Number(event.target.value) as Redirect['status'] })
          }
        >
          {[301, 302, 307, 308].map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
        <button type="submit">Add</button>
      </form>
      <ErrorNote message={errors.redirect ?? ''} />
    </Dialog>
  )
}
