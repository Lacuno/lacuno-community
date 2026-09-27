import type { Page } from '@lacuno/schema'
import { Brand, type Role, SignUpLink } from './App.js'
import { useConfig } from './api.js'
import { type Connection, connectionLabel } from './ConnectPanel.js'
import { EditorIcon } from './EditorIcon.js'
import type { DocumentSession } from './session.js'

export function EditorHeader({
  session,
  role,
  page,
  back,
  uploadingImage,
  publish,
  connections,
  connect,
}: {
  session: DocumentSession
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
                  : saved
                    ? 'All changes saved'
                    : 'Saved'}
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
