import { useCallback, useEffect, useState } from 'react'
import { SignUpLink } from './App.js'
import { api, message, useConfig } from './api.js'
import { ConnectIcon } from './ConnectIcon.js'
import { type ConnectApp, connectApps } from './connectApps.js'
import { Dialog, ErrorNote } from './Dialog.js'
import type { SiteEvent } from './liveEvents.js'
import './publishing.css'

export type Connection = {
  id: string
  app: string
  approvedAt: number
  lastActiveAt: number | null
  /** An MCP session is open. */
  active: boolean
}

const action = {
  link: 'Open link',
  command: 'Copy command',
  paste: 'Copy URL',
}
const time = (at: number) => new Date(at).toLocaleString()

/** The site's AI connections, polled every 10s, or every 2s while the panel is open. */
export function useConnections(siteId: string, open: boolean) {
  const [connections, setConnections] = useState<Connection[]>([])
  const refresh = useCallback(
    () => api<Connection[]>(`/api/sites/${siteId}/connections`).then(setConnections),
    [siteId],
  )
  useEffect(() => {
    const poll = () => void refresh().catch(() => {})
    poll()
    const timer = setInterval(poll, open ? 2000 : 10000)
    return () => clearInterval(timer)
  }, [refresh, open])
  return { connections, refresh }
}

/** The header button's label: the active app, else the idle one, else the call to connect. */
export function connectionLabel(connections: Connection[]) {
  const connection = connections.find((item) => item.active) ?? connections[0]
  if (!connection) return { state: 'none', label: 'Connect your AI' }
  return connection.active
    ? { state: 'active', label: `${connection.app} connected` }
    : { state: 'idle', label: `${connection.app} idle` }
}

export function ConnectPanel({
  siteId,
  connections,
  refresh,
  activity,
  close,
}: {
  siteId: string
  connections: Connection[]
  refresh: () => Promise<void>
  activity: SiteEvent[]
  close: () => void
}) {
  const { config, error: configError } = useConfig()
  const [chosen, setChosen] = useState<ConnectApp>()
  // The app the designer started registering, and the connections that existed then.
  const [waiting, setWaiting] = useState<{ app: string; known: string[] }>()
  const [status, setStatus] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const url = config ? `${config.origin || window.location.origin}/mcp/${siteId}` : ''
  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus(done)
    } catch {
      setStatus('Could not copy. Select the text and copy it yourself.')
    }
  }
  /** Waits for the app's connection, after copying what it needs unless it opens a link. */
  const start = (app: ConnectApp, text?: string) => {
    setWaiting({ app: app.name, known: connections.map((item) => item.id) })
    if (text) void copy(text, `Copied for ${app.name}.`)
  }
  const arrived = waiting && connections.some((item) => !waiting.known.includes(item.id))
  const disconnect = async (id: string) => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/sites/${siteId}/connections/${id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        // The API's CSRF check wants JSON on every write.
        headers: { 'Content-Type': 'application/json' },
      })
      // 404: the connection is already gone, which is what the designer wanted.
      if (!response.ok && response.status !== 404) throw new Error('Could not disconnect')
      setConfirm('')
      await refresh()
    } catch (error) {
      setError(message(error, 'Could not disconnect'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title="Connect your AI"
      description="Let an AI app edit this site through its MCP address. You approve each app once."
      className="publish-dialog connect-dialog"
      closeName="Close connect your AI"
      close={close}
    >
      {!config && !configError && <p role="status">Loading…</p>}
      {config?.try && (
        <p className="note">
          Sign up to connect your AI. <SignUpLink />
        </p>
      )}
      {config && !config.try && (
        <>
          <p role="status" className="connect-status">
            {waiting && !arrived
              ? `Waiting for ${waiting.app}… Approve access when the app asks.`
              : status}
          </p>
          <div className="connect-picker">
            {connectApps.map((app) => (
              <button
                type="button"
                className="connect-app"
                key={app.id}
                aria-pressed={app === chosen}
                onClick={() => setChosen(app === chosen ? undefined : app)}
              >
                <ConnectIcon name={app.icon} />
                {app.name}
              </button>
            ))}
          </div>
          {chosen ? (
            <ConnectSteps app={chosen} url={url} local={config.local} start={start} />
          ) : (
            <p className="hint connect-other">
              Pick your app above. Any other MCP client takes the site's address: <code>{url}</code>
              <button
                type="button"
                className="connect-copy"
                onClick={() => void copy(url, 'MCP URL copied.')}
              >
                Copy MCP URL
              </button>
            </p>
          )}
        </>
      )}
      <h3 className="connect-heading">Connections</h3>
      {!connections.length && <p className="hint">No AI app is connected to this site yet.</p>}
      <ol className="release-list">
        {connections.map((item) => (
          <li key={item.id}>
            <div className="release-title">
              <strong>{item.app}</strong>
              <span className="release-status" data-status={item.active ? 'active' : 'idle'}>
                {item.active ? 'Active' : 'Idle'}
              </span>
            </div>
            <p className="hint">
              Approved {time(item.approvedAt)} · Last active{' '}
              {item.lastActiveAt ? time(item.lastActiveAt) : 'never'}
            </p>
            {confirm === item.id ? (
              <div className="rollback-confirm">
                <p>Disconnect {item.app}? It loses access to this site.</p>
                <button type="button" disabled={busy} onClick={() => void disconnect(item.id)}>
                  Confirm disconnect
                </button>
                <button type="button" onClick={() => setConfirm('')}>
                  Cancel
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirm(item.id)}>
                Disconnect {item.app}
              </button>
            )}
          </li>
        ))}
      </ol>
      <h3 className="connect-heading">Activity</h3>
      {!activity.length && <p className="hint">Edits by you and your AI apps will appear here.</p>}
      <ol className="release-list">
        {activity.slice(0, 50).map((item) => (
          <li key={item.revision}>
            <div className="release-title">
              <strong>{item.actor.kind === 'agent' ? item.actor.app : 'You'}</strong>
              <time dateTime={new Date(item.at).toISOString()}>{time(item.at)}</time>
            </div>
            <p>{item.summary}</p>
          </li>
        ))}
      </ol>
      <ErrorNote message={error || configError} />
    </Dialog>
  )
}

/** One app's instructions: what to do, the thing to copy or open, and what to try if it fails. */
function ConnectSteps({
  app,
  url,
  local,
  start,
}: {
  app: ConnectApp
  url: string
  local: boolean
  start: (app: ConnectApp, text?: string) => void
}) {
  const disabled = app.needsPublicAddress && local
  return (
    <div className="connect-card">
      <p>{app.how}</p>
      <code>{app.registration === 'link' ? url : app.build(url)}</code>
      {app.registration === 'link' ? (
        <a href={app.build(url)} onClick={() => start(app)}>
          {action.link}
        </a>
      ) : (
        <button type="button" disabled={disabled} onClick={() => start(app, app.build(url))}>
          {action[app.registration]}
        </button>
      )}
      {disabled && <p className="hint">Needs a public address. Works on Freeflow Cloud.</p>}
      <p className="hint">{app.fallback}</p>
      {app.bridge && (
        <>
          <pre>{app.bridge(url)}</pre>
          <button type="button" onClick={() => start(app, app.bridge?.(url))}>
            Copy bridge snippet
          </button>
        </>
      )}
    </div>
  )
}
