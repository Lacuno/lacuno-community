import { type Document, safeLinkHref } from '@freeflow/schema'
import { type ReactNode, useId, useRef, useState } from 'react'
import './text-toolbar.css'

export function TextToolbar({
  doc,
  scope,
  values,
  placeholders = {},
  disabled,
  linkDisabled = false,
  currentLink,
  change,
  link,
  children,
}: {
  doc: Document
  scope: 'Whole text' | 'Selected text'
  values: Record<string, string>
  placeholders?: Record<string, string>
  disabled: boolean
  linkDisabled?: boolean
  currentLink?: Record<string, unknown> | undefined
  change: (property: string, value: string) => void
  link: (attrs: { pageId: string | null; href: string | null } | null) => void
  children?: ReactNode
}) {
  const popoverId = useId()
  const popover = useRef<HTMLDivElement>(null)
  const [pageId, setPageId] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const bold = Number(values['font-weight']) >= 600
  const italic = values['font-style'] === 'italic'
  return (
    <section className="text-toolbar" aria-label="Text formatting">
      <div className="text-toolbar-fields">
        <label className="text-font">
          Font
          <select
            aria-label="Font"
            disabled={disabled}
            value={values['font-family'] ?? ''}
            onChange={(event) => change('font-family', event.target.value)}
          >
            <option value="">Inherited</option>
            {values['font-family'] &&
              !['Inter, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'monospace'].includes(
                values['font-family'],
              ) && <option>{values['font-family']}</option>}
            {['Inter, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'monospace'].map(
              (font) => (
                <option key={font}>{font}</option>
              ),
            )}
          </select>
        </label>
        <label className="text-size">
          Size
          <input
            aria-label="Size"
            disabled={disabled}
            value={values['font-size'] ?? ''}
            placeholder={placeholders['font-size'] || 'Inherited'}
            onChange={(event) => change('font-size', event.target.value)}
          />
        </label>
        <button
          type="button"
          aria-label="Bold"
          aria-pressed={bold}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => change('font-weight', bold ? '400' : '700')}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={italic}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => change('font-style', italic ? 'normal' : 'italic')}
        >
          <em>I</em>
        </button>
        <label>
          Color
          <input
            type="color"
            aria-label="Text color"
            disabled={disabled}
            value={colorHex(values.color ?? '')}
            onChange={(event) => change('color', event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={disabled || linkDisabled}
          popoverTarget={popoverId}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            setPageId(typeof currentLink?.pageId === 'string' ? currentLink.pageId : '')
            setUrl(typeof currentLink?.href === 'string' ? currentLink.href : '')
            const rect = event.currentTarget.getBoundingClientRect()
            if (popover.current) {
              popover.current.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - 332))}px`
              popover.current.style.top = `${rect.bottom + 8}px`
            }
            setError('')
          }}
        >
          Link
        </button>
        <label className="text-alignment" title="Applies to the whole text block">
          Alignment
          <select
            aria-label="Alignment"
            disabled={disabled}
            value={values['text-align'] ?? ''}
            onChange={(event) => change('text-align', event.target.value)}
          >
            <option value="">Inherited</option>
            {['start', 'left', 'center', 'right', 'justify'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="text-line-height" title="Applies to the whole text block">
          Line height
          <input
            aria-label="Line height"
            disabled={disabled}
            value={values['line-height'] ?? ''}
            placeholder={placeholders['line-height'] || 'Inherited'}
            onChange={(event) => change('line-height', event.target.value)}
          />
        </label>
      </div>
      <div className="text-toolbar-footer">
        <span className="text-scope">{scope}</span>
        <div className="text-edit-actions">{children}</div>
      </div>
      <div
        ref={popover}
        id={popoverId}
        popover="auto"
        className="text-link-popover"
        role="dialog"
        aria-label="Link destination"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!pageId && !safeLinkHref(url)) {
              setError('Enter an https:// URL, /path, #section, mailto: or tel: destination.')
              return
            }
            link({ pageId: pageId || null, href: pageId ? null : url.trim() })
            popover.current?.hidePopover()
          }}
        >
          <strong>Link destination</strong>
          <label>
            Link to page
            <select
              aria-label="Link to page"
              value={pageId}
              disabled={disabled}
              onChange={(event) => setPageId(event.target.value)}
            >
              <option value="">URL or email</option>
              {Object.values(doc.pages)
                .filter((page) => !page.collection)
                .map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.name}
                  </option>
                ))}
            </select>
          </label>
          {!pageId && (
            <label>
              Destination
              <input
                aria-label="Link destination"
                disabled={disabled}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://example.com"
              />
            </label>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" disabled={disabled}>
              Apply link
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                link(null)
                popover.current?.hidePopover()
              }}
            >
              Remove link
            </button>
            <button type="button" onClick={() => popover.current?.hidePopover()}>
              Cancel link
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}

function colorHex(value: string) {
  if (/^#[\da-f]{6}$/i.test(value)) return value
  const rgb = value.match(/^rgb\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/)
  return rgb
    ? `#${rgb
        .slice(1, 4)
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('')}`
    : '#000000'
}
