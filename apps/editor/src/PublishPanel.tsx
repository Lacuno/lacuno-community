import { useCallback, useEffect, useState } from 'react'
import { api, message } from './api.js'
import { Dialog, ErrorNote } from './Dialog.js'
import './publishing.css'

type Release = {
  id: string
  version: number
  name: string | null
  status: 'queued' | 'building' | 'ready' | 'failed'
  createdAt: number
  finishedAt: number | null
  error: string | null
  warnings: { message: string }[]
}
type History = {
  enabled: boolean
  publishedId: string | null
  url: string | null
  releases: Release[]
}

const title = (row: Release) => (row.name ? `v${row.version} · ${row.name}` : `v${row.version}`)

export function PublishPanel({
  siteId,
  revision,
  close,
}: {
  siteId: string
  revision: number
  close: () => void
}) {
  const [history, setHistory] = useState<History>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string>()
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string }>()
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
        if (!controller.signal.aborted) setError(message(error, 'Could not load releases'))
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
      return true
    } catch (error) {
      setError(message(error, 'Request failed'))
      await refresh().catch(() => {})
      return false
    } finally {
      setBusy(false)
    }
  }
  const current = history?.releases.find((row) => row.id === history.publishedId)
  // The newest release and the live one stay in view; older ones fold away.
  const latest = history?.releases.filter((row, index) => index === 0 || row === current) ?? []
  const earlier = history?.releases.filter((row) => !latest.includes(row)) ?? []
  const release = (row: Release) => (
    <li key={row.id}>
      <div className="release-title">
        {renaming?.id === row.id ? (
          <form
            className="release-rename"
            onSubmit={(event) => {
              event.preventDefault()
              void run(`/api/sites/${siteId}/releases/${row.id}/name`, {
                name: renaming.name,
              }).then((ok) => ok && setRenaming(undefined))
            }}
          >
            <input
              aria-label={`Name for v${row.version}`}
              value={renaming.name}
              maxLength={80}
              onChange={(event) => setRenaming({ id: row.id, name: event.target.value })}
            />
            <button type="submit" disabled={busy}>
              Save name
            </button>
            <button type="button" onClick={() => setRenaming(undefined)}>
              Cancel rename
            </button>
          </form>
        ) : (
          <strong>{title(row)}</strong>
        )}
        <span className="release-status" data-status={row.status}>
          {row === current
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
            {[...new Set(row.warnings.map((warning) => warning.message))].map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </details>
      )}
      {renaming?.id !== row.id && (
        <button type="button" onClick={() => setRenaming({ id: row.id, name: row.name ?? '' })}>
          Rename v{row.version}
        </button>
      )}
      {row.status === 'ready' && row !== current && (
        <button type="button" disabled={busy || pending} onClick={() => setConfirm(row.id)}>
          Restore v{row.version}
        </button>
      )}
      {confirm === row.id && (
        <div className="rollback-confirm">
          <p>Make {title(row)} live again? Your editing draft will stay unchanged.</p>
          <button
            type="button"
            disabled={busy || pending}
            onClick={() =>
              void run(`/api/sites/${siteId}/releases/${row.id}/activate`, {
                publishedId: current?.id ?? null,
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
  )
  const nextVersion = Math.max(0, ...(history?.releases.map((row) => row.version) ?? [])) + 1
  return (
    <Dialog
      title="Publish your site"
      label="Publishing and release history"
      description="Publish a saved snapshot. Editing afterward will not change the live site."
      className="publish-dialog"
      closeName="Close publishing"
      close={close}
    >
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
                    {current ? `Live: ${title(current)}` : 'This site has not been published yet.'}
                  </p>
                </div>
                <label className="release-name">
                  Release name
                  <input
                    value={name}
                    placeholder="Spring launch"
                    maxLength={80}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="publish-action"
                  disabled={busy || pending}
                  onClick={() =>
                    void run(`/api/sites/${siteId}/releases`, {
                      expectedRevision: revision,
                      publishedId: history.publishedId,
                      name,
                    }).then((ok) => ok && setName(''))
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
          <ol className="release-list">{latest.map(release)}</ol>
          {!!earlier.length && (
            <details className="earlier-releases">
              <summary>Earlier releases ({earlier.length})</summary>
              <ol className="release-list">{earlier.map(release)}</ol>
            </details>
          )}
        </>
      )}
      <ErrorNote message={error} />
    </Dialog>
  )
}
