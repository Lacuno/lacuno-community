import { type Document, safeLinkHref } from '@miralo/schema'
import { useId, useRef, useState } from 'react'
import { ErrorNote } from './Dialog.js'
import { placePopover } from './popover.js'
import './text-toolbar.css'

/** A chosen destination: a page, which survives a path change, or a plain URL. */
export type LinkValue = { pageId: string | null; href: string | null }

/** The page-or-URL popover behind a trigger button, shared by the text toolbar and inspector. */
export function LinkTarget({
  doc,
  current,
  disabled,
  label,
  apply,
  remove,
}: {
  doc: Document
  current?: { pageId?: string | undefined; href?: string | undefined } | undefined
  disabled: boolean
  label: string
  apply: (value: LinkValue) => void
  remove?: () => void
}) {
  const popoverId = useId()
  const popover = useRef<HTMLDivElement>(null)
  const [pageId, setPageId] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        popoverTarget={popoverId}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          setPageId(current?.pageId ?? '')
          setUrl(current?.href ?? '')
          placePopover(event.currentTarget, popover.current)
          setError('')
        }}
      >
        {label}
      </button>
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
            const href = safeLinkHref(url)
            if (!pageId && !href) {
              setError('Enter an https:// URL, /path, #section, mailto: or tel: destination.')
              return
            }
            apply({ pageId: pageId || null, href: pageId ? null : href! })
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
          <ErrorNote message={error} />
          <div className="row">
            <button type="submit" disabled={disabled}>
              Apply link
            </button>
            {remove && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  remove()
                  popover.current?.hidePopover()
                }}
              >
                Remove link
              </button>
            )}
            <button type="button" onClick={() => popover.current?.hidePopover()}>
              Cancel link
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
