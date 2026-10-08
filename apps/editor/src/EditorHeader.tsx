import type { Page } from '@lacuno/schema'
import { useId, useRef } from 'react'
import { Brand, type Role, SignUpLink } from './App.js'
import { useConfig } from './api.js'
import { type Connection, connectionLabel } from './ConnectPanel.js'
import { EditorIcon } from './EditorIcon.js'
import { placePopover } from './popover.js'
import type { DocumentSession } from './session.js'

/** When an edit happened, in words for recent ones. */
function ago(at: number) {
  const minutes = Math.round((Date.now() - at) / 60000)
  return minutes < 1
    ? 'Just now'
    : minutes < 60
      ? `${minutes} min ago`
      : new Date(at).toLocaleString()
}

export function EditorHeader({
  session,
  notice,
  role,
  page,
  back,
  uploadingImage,
  publish,
  connections,
  connect,
}: {
  session: DocumentSession
  /** A refused shortcut's reason, on the status line for a moment while nothing is saving. */
  notice: string
  role: Role
  page: Page | undefined
  back: () => void
  uploadingImage: boolean
  publish: () => void
  connections: Connection[]
  connect: () => void
}) {
  const { doc, snapshot, error, busy, dirty, conflict, saved } = session
  const connection = connectionLabel(connections)
  const { config } = useConfig()
  const historyId = useId()
  const historyPanel = useRef<HTMLDivElement>(null)
  return (
    <header className="editor-header">
      <button
        type="button"
        className="back-button"
        onClick={() => session.leave(back)}
        aria-label="Back to sites"
      >
        <EditorIcon name="back" />
      </button>
      <Brand />
      <span className="header-divider" />
      <span className="site-name">
        {doc?.site.name ?? 'Opening site…'}
        <span className="site-page-divider"> / </span>
        {page?.name}
      </span>
      <div className="row history-controls">
        <button
          type="button"
          onClick={() => session.travel('undo')}
          disabled={!session.canUndo}
          title="Undo saved edit (⌘/Ctrl Z)"
          aria-label="Undo"
          aria-keyshortcuts="Meta+Z Control+Z"
        >
          <EditorIcon name="undo" />
        </button>
        <button
          type="button"
          onClick={() => session.travel('redo')}
          disabled={!session.canRedo}
          title="Redo saved edit (⌘/Ctrl Shift Z)"
          aria-label="Redo"
          aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y"
        >
          <EditorIcon name="redo" />
        </button>
        <button
          type="button"
          popoverTarget={historyId}
          onClick={(event) => placePopover(event.currentTarget, historyPanel.current)}
          title="History"
          aria-label="History"
        >
          <EditorIcon name="clock" />
        </button>
        <div ref={historyPanel} id={historyId} popover="auto" className="history-popover">
          <h3>History</h3>
          {!session.activity.length && <p>Edits by you and your AI apps will appear here.</p>}
          <ol>
            {session.activity.slice(0, 50).map((item) => (
              <li key={item.revision}>
                <strong>
                  {item.actor.kind === 'editor'
                    ? 'You'
                    : item.actor.user
                      ? `${item.actor.app}, via ${item.actor.user}`
                      : item.actor.app}
                </strong>
                <time dateTime={new Date(item.at).toISOString()}>{ago(item.at)}</time>
                <p className="history-summary">{item.summary}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <span
        className="save-state"
        role="status"
        data-state={conflict || error ? 'error' : busy || dirty ? 'pending' : 'saved'}
      >
        {role === 'viewer'
          ? 'View only'
          : conflict
            ? 'Changes paused'
            : error
              ? 'Could not save'
              : busy
                ? 'Saving…'
                : dirty
                  ? 'Changes pending…'
                  : notice || (saved ? 'All changes saved' : 'Saved')}
      </span>
      <button
        type="button"
        onClick={() => session.reload()}
        disabled={busy}
        aria-label="Reload site"
        title="Reload site"
        className="reload-button"
      >
        <EditorIcon name="reload" />
      </button>
      {role !== 'viewer' && (
        <button
          type="button"
          className="connect-trigger"
          data-state={connection.state}
          onClick={connect}
        >
          <EditorIcon name="sparkle" />
          {connection.label}
        </button>
      )}
      {config?.try && <SignUpLink />}
      {role === 'owner' && (
        <button
          type="button"
          className="publish-trigger publish-action"
          disabled={!snapshot || busy || conflict || uploadingImage}
          onClick={async () => {
            if (!(await session.flushPending())) {
              session.setError('Finish or correct your pending edits before publishing.')
              return
            }
            session.setDirty(false)
            publish()
          }}
        >
          Publish
        </button>
      )}
    </header>
  )
}
