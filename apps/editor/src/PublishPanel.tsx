import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import './publishing.css'

type History = {
  enabled: boolean
  publishedId: string | null
  url: string | null
  releases: {
    id: string
    version: number
    status: 'queued' | 'building' | 'ready' | 'failed'
    createdAt: number
    finishedAt: number | null
    error: string | null
    warnings: { message: string }[]
  }[]
}

export function PublishPanel({
  siteId,
  revision,
  close,
}: {
  siteId: string
  revision: number
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [history, setHistory] = useState<History>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string>()
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api<History>(`/api/sites/${siteId}/releases`, undefined, signal)
      setHistory(result)
      return result
    },
    [siteId],
  )
  const pending =
    history?.releases.some((row) => row.status === 'queued' || row.status === 'building') ?? false
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies: accepting a new publish restarts polling after an idle history view.
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await refresh(controller.signal)
        if (
          result.releases.some((row) => row.status === 'queued' || row.status === 'building') &&
          !controller.signal.aborted
        )
          timer = setTimeout(poll, 1000)
      } catch (error) {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : 'Could not load releases')
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [refresh, pending])
  const run = async (url: string, body: unknown) => {
    setBusy(true)
    setError('')
    try {
      await api(url, body)
      setConfirm(undefined)
      await refresh()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Request failed')
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  const current = history?.releases.find((row) => row.id === history.publishedId)
  const nextVersion = Math.max(0, ...(history?.releases.map((row) => row.version) ?? [])) + 1
  return (
    <dialog
      ref={dialog}
      className="publish-dialog"
      aria-label="Publishing and release history"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header>
        <div>
          <h2>Publish your site</h2>
          <p>Publish a saved snapshot. Editing afterward will not change the live site.</p>
        </div>
        <button type="button" onClick={close} aria-label="Close publishing">
          Close
        </button>
      </header>
      {!history && <p role="status">Loading releases…</p>}
      {history && (
        <>
          {!history.enabled ? (
            <p className="note">
              Publishing is not configured. Set a separate publishing origin on the server.
            </p>
          ) : (
            <>
              <div className="publish-summary">
                <div>
                  <strong>Saved draft</strong>
                  <p>
                    {current
                      ? `Live: v${current.version}`
                      : 'This site has not been published yet.'}
                  </p>
                </div>
                <button
                  type="button"
                  className="publish-action"
                  disabled={busy || pending}
                  onClick={() =>
                    void run(`/api/sites/${siteId}/releases`, {
                      expectedRevision: revision,
                      publishedId: history.publishedId,
                    })
                  }
                >
                  Publish v{nextVersion}
                </button>
              </div>
              {current && history.url && (
                <a href={history.url} target="_blank" rel="noopener noreferrer">
                  Open published site ↗
                </a>
              )}
              {pending && (
                <p role="status">
                  Publishing… You can close this window and keep editing. The current live release
                  stays available.
                </p>
              )}
            </>
          )}
          <div className="release-heading">
            <h3>Release history</h3>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError('')
                void refresh().catch((error) => setError(error.message))
              }}
            >
              Refresh releases
            </button>
          </div>
          {!history.releases.length && (
            <p className="hint">Your published snapshots and build results will appear here.</p>
          )}
          <ol className="release-list">
            {history.releases.map((row) => (
              <li key={row.id}>
                <div className="release-title">
                  <strong>v{row.version}</strong>
                  <span className="release-status" data-status={row.status}>
                    {row.id === history.publishedId
                      ? 'Live'
                      : row.status === 'ready'
                        ? 'Ready'
                        : row.status === 'failed'
                          ? 'Failed'
                          : row.status === 'building'
                            ? 'Building'
                            : 'Queued'}
                  </span>
                </div>
                <time dateTime={new Date(row.createdAt).toISOString()}>
                  {new Date(row.createdAt).toLocaleString()}
                </time>
                {row.error && <p className="error">{row.error}</p>}
                {!!row.warnings.length && (
                  <details>
                    <summary>{row.warnings.length} build warnings</summary>
                    <ul>
                      {[...new Set(row.warnings.map((warning) => warning.message))].map(
                        (message) => (
                          <li key={message}>{message}</li>
                        ),
                      )}
                    </ul>
                  </details>
                )}
                {row.status === 'ready' && row.id !== history.publishedId && (
                  <button
                    type="button"
                    disabled={busy || pending}
                    onClick={() => setConfirm(row.id)}
                  >
                    Restore v{row.version}
                  </button>
                )}
                {confirm === row.id && (
                  <div className="rollback-confirm">
                    <p>Make v{row.version} live again? Your editing draft will stay unchanged.</p>
                    <button
                      type="button"
                      disabled={busy || pending}
                      onClick={() =>
                        void run(`/api/sites/${siteId}/releases/${row.id}/activate`, {
                          publishedId: history.publishedId,
                        })
                      }
                    >
                      Confirm rollback
                    </button>
                    <button type="button" onClick={() => setConfirm(undefined)}>
                      Cancel rollback
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  )
}
