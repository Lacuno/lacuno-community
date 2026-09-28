import { blogStarter } from './binding.js'
import type { CmsView } from './CollectionManager.js'
import { EditorIcon } from './EditorIcon.js'
import type { DocumentSession } from './session.js'

/** The rail's CMS panel: the site's collections, each opening the CMS dialog on its entries. */
export function CmsPanel({
  session,
  open,
  showPage,
}: {
  session: DocumentSession
  open: (view: CmsView) => void
  /** Opens a page on the canvas. */
  showPage: (id: string) => void
}) {
  const { doc, frozen, readOnly } = session
  if (!doc) return null
  const collections = Object.values(doc.collections)
  return (
    <>
      <div className="panel-title">
        Collections<span>{collections.length}</span>
      </div>
      {!readOnly && (
        <div className="pages-toolbar">
          <button
            type="button"
            disabled={frozen}
            onClick={() => open({ collection: 'new', entry: '' })}
          >
            <EditorIcon name="plus" />
            New collection
          </button>
        </div>
      )}
      <div className="page-list">
        {collections.map((col) => (
          <button
            type="button"
            key={col.id}
            className="page-link"
            aria-haspopup="dialog"
            onClick={() => open({ collection: col.id, entry: '' })}
          >
            <EditorIcon name="database" />
            {col.name}
            <span className="page-path">{doc.entries[col.id]?.length ?? 0}</span>
          </button>
        ))}
        {!collections.length && (
          <div className="cms-panel-empty">
            <p>
              Collections hold content such as blog posts or team members, for pages and lists to
              show.
            </p>
            {!readOnly && (
              <button
                type="button"
                disabled={frozen}
                onClick={async () => {
                  const starter = blogStarter(doc)
                  if (await session.save(starter.operations)) showPage(starter.listPageId)
                }}
              >
                Start a blog
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
