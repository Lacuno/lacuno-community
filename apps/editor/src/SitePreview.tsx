import { useEffect, useMemo, useRef, useState } from 'react'
import { api, embed } from './api.js'
import { EditorIcon } from './EditorIcon.js'

type Shown = { html: string; path: string }

const widths = [
  ['desktop', 'Desktop', '100%'],
  ['tablet', 'Tablet', '768px'],
  ['mobile', 'Mobile', '390px'],
] as const

/**
 * Preview mode: the draft as it will publish, its scripts, motion and code running, page by page
 * as the site's own links lead. The frame gets an origin of its own (no allow-same-origin), so
 * nothing the site runs reaches the editor or its session.
 */
export function SitePreview({
  siteId,
  start,
  close,
}: {
  siteId: string
  /** The page, entry and language being edited, where the preview opens. */
  start: { page: string; entry: string; locale: string }
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [query, setQuery] = useState(() => new URLSearchParams(start).toString())
  const [shown, setShown] = useState<Shown>()
  const [width, setWidth] = useState<string>('100%')
  const [note, setNote] = useState('')
  useEffect(() => dialog.current?.showModal(), [])
  useEffect(() => {
    const controller = new AbortController()
    api<Shown>(`/api/sites/${siteId}/site-preview?${query}`, undefined, controller.signal).then(
      setShown,
      (error) => {
        if (!controller.signal.aborted) setNote(error.message)
      },
    )
    return () => controller.abort()
  }, [siteId, query])
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      const to = event.data?.lacunoPreview
      if (typeof to !== 'string') return
      if (to === 'form') return setNote('Forms are not sent in preview.')
      setNote('')
      setQuery(new URLSearchParams({ path: to }).toString())
    }
    addEventListener('message', receive)
    return () => removeEventListener('message', receive)
  }, [])
  // Inside a host the frame cannot take srcdoc, as with the canvas.
  const src = useMemo(
    () =>
      shown && embed
        ? URL.createObjectURL(new Blob([shown.html], { type: 'text/html' }))
        : undefined,
    [shown],
  )
  useEffect(
    () => () => {
      if (src) URL.revokeObjectURL(src)
    },
    [src],
  )
  return (
    <dialog
      ref={dialog}
      className="site-preview"
      aria-label="Preview"
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
    >
      <header className="site-preview-bar">
        <strong>Preview</strong>
        <span className="site-preview-path">{shown?.path}</span>
        <fieldset className="viewport-switch" aria-label="Preview width">
          {widths.map(([icon, label, size]) => (
            <button
              type="button"
              key={icon}
              aria-label={label}
              title={label}
              className={width === size ? 'active' : ''}
              onClick={() => setWidth(size)}
            >
              <EditorIcon name={icon} />
            </button>
          ))}
        </fieldset>
        <span className="site-preview-note" role="status">
          {note}
        </span>
        <button type="button" className="site-preview-close" onClick={close}>
          Close preview
        </button>
      </header>
      {shown && (
        <iframe
          ref={frame}
          title="Site preview"
          sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
          style={{ width }}
          {...(src ? { src } : { srcDoc: shown.html })}
        />
      )}
    </dialog>
  )
}
