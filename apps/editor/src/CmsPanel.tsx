import { useState } from 'react'
import { type CmsView, CollectionManager } from './CollectionManager.js'
import { EditorIcon } from './EditorIcon.js'
import type { DocumentSession } from './session.js'

/** The rail's CMS panel: the site's collections, each opening the CMS dialog on its entries. */
export function CmsPanel({ siteId, session }: { siteId: string; session: DocumentSession }) {
  const [view, setView] = useState<CmsView>()
  const { doc, frozen, readOnly } = session
  if (!doc) return null
  const collections = Object.values(doc.collections)
  const open = (collection: string, tab: CmsView['tab'] = 'entries') =>
    setView({ collection, tab, entry: '' })
  return (
    <>
      <div className="panel-title">
        Collections<span>{collections.length}</span>
      </div>
      <div className="pages-toolbar">
        {!readOnly && (
          <button type="button" disabled={frozen} onClick={() => open('new', 'fields')}>
            <EditorIcon name="plus" />
            New collection
          </button>
        )}
      </div>
      <div className="page-list">
        {collections.map((col) => (
          <button
            type="button"
            key={col.id}
            className="page-link"
            aria-haspopup="dialog"
            onClick={() => open(col.id)}
          >
            <EditorIcon name="database" />
            {col.name}
            <span className="page-path">{doc.entries[col.id]?.length ?? 0}</span>
          </button>
        ))}
        {!collections.length && (
          <p className="cms-panel-empty">
            Collections hold content such as blog posts or team members, for pages and lists to
            show.
          </p>
        )}
      </div>
      {view && (
        <CollectionManager
          siteId={siteId}
          doc={doc}
          readOnly={readOnly}
          disabled={session.conflict}
          save={session.save}
          undo={() => session.travel('undo')}
          view={view}
          setView={setView}
          close={() => setView(undefined)}
        />
      )}
    </>
  )
}
