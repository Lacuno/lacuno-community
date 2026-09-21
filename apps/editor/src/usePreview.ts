import { useEffect, useState } from 'react'
import { api } from './api.js'

export type Preview = {
  html: string
  revision: number
  warnings: { node: string; message: string }[]
}

type Options = {
  siteId: string
  pageId: string
  activeEntry: string
  editingId: string
  revision: number | undefined
  onStale: () => void
  setError: (message: string) => void
}

/** The rendered canvas for the page, entry or component being edited. */
export function usePreview({
  siteId,
  pageId,
  activeEntry,
  editingId,
  revision,
  onStale,
  setError,
}: Options) {
  const [preview, setPreview] = useState<Preview>()
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different page or entry must discard the prior canvas.
  useEffect(() => {
    setPreview(undefined)
  }, [pageId, activeEntry, editingId])
  useEffect(() => {
    if (!pageId || revision === undefined) return
    const controller = new AbortController()
    api<Preview>(
      `/api/sites/${siteId}/preview?page=${encodeURIComponent(pageId)}&entry=${encodeURIComponent(activeEntry)}${editingId ? `&component=${encodeURIComponent(editingId)}` : ''}`,
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
  }, [siteId, pageId, activeEntry, revision, editingId, onStale, setError])
  return preview
}
