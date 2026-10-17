import { useEffect } from 'react'
import { api } from './api.js'

export type Preview = {
  html: string
  revision: number
  warnings: { node: string; message: string }[]
}
/** The preview route's query: the page, its entry on a collection page, the component being edited. */
export type PreviewQuery = { page: string; entry?: string; component?: string; locale?: string }

type Options = {
  siteId: string
  pageId: string
  activeEntry: string
  editingId: string
  /** Another language than the primary, or '' for the primary. */
  locale: string
  revision: number | undefined
  /** Held by the editor, since a save lands its own canvas here (session.ts). */
  preview: Preview | undefined
  setPreview: (preview: Preview | undefined) => void
  onStale: () => void
  setError: (message: string) => void
}

/** Fetches the canvas for the page, entry or component being edited when a save has not brought it. */
export function usePreview({
  siteId,
  pageId,
  activeEntry,
  editingId,
  locale,
  revision,
  preview,
  setPreview,
  onStale,
  setError,
}: Options) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different page or entry must discard the prior canvas.
  useEffect(() => {
    setPreview(undefined)
  }, [pageId, activeEntry, editingId, locale])
  useEffect(() => {
    if (!pageId || revision === undefined || preview?.revision === revision) return
    const controller = new AbortController()
    api<Preview>(
      `/api/sites/${siteId}/preview?page=${encodeURIComponent(pageId)}&entry=${encodeURIComponent(activeEntry)}${editingId ? `&component=${encodeURIComponent(editingId)}` : ''}${locale ? `&locale=${encodeURIComponent(locale)}` : ''}`,
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return
        if (data.revision !== revision) onStale()
        else setPreview(data)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [
    siteId,
    pageId,
    activeEntry,
    revision,
    editingId,
    locale,
    preview,
    setPreview,
    onStale,
    setError,
  ])
}
