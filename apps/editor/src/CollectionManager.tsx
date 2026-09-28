import type { Operation } from '@lacuno/document'
import type { Document } from '@lacuno/schema'
import { useState } from 'react'
import { uploadAsset } from './AssetsPanel.js'
import { message } from './api.js'
import { CollectionSettings } from './CollectionSettings.js'
import { newCollection } from './cms.js'
import { Dialog, ErrorNote } from './Dialog.js'
import { EditorIcon } from './EditorIcon.js'
import { Entries } from './Entries.js'
import './assets.css'
import './cms.css'

export type CmsView = { collection: string; tab: 'entries' | 'fields'; entry: string }

/** Collections, their fields and their entries in one large dialog, like the asset manager. */
export function CollectionManager({
  siteId,
  doc,
  readOnly,
  disabled,
  save,
  undo,
  view,
  setView,
  close,
}: {
  siteId: string
  doc: Document
  readOnly: boolean
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
  undo: () => void
  view: CmsView
  setView: (view: CmsView) => void
  close: () => void
}) {
  const [creating, setCreating] = useState(view.collection === 'new' ? '' : undefined)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  // An entry with unsaved changes asks before anything takes it away.
  const [dirty, setDirty] = useState(false)
  const leave = () => !dirty || window.confirm('Discard your unsaved changes?')
  const collections = Object.values(doc.collections)
  const col =
    view.collection === 'new' ? undefined : (doc.collections[view.collection] ?? collections[0])
  const entryCount = Object.values(doc.entries).reduce((sum, list) => sum + list.length, 0)
  const show = (next: Partial<CmsView>) => setView({ ...view, entry: '', ...next })
  const upload = async (file: File) => {
    setError('')
    try {
      const asset = await uploadAsset(siteId, file)
      if (doc.assets[asset.id] || (await save([{ type: 'asset.create', ...asset }])))
        return asset.id
    } catch (err) {
      setError(message(err, 'Could not upload the file.'))
    }
  }
  const create = async () => {
    if (!creating?.trim()) return setError('Enter a collection name.')
    const operation = newCollection(doc, creating)
    if (await save([operation])) {
      setCreating(undefined)
      setError('')
      show({
        collection: operation.type === 'collection.create' ? operation.id! : '',
        tab: 'fields',
      })
    }
  }
  return (
    <Dialog
      title="CMS"
      description={`${collections.length} ${collections.length === 1 ? 'collection' : 'collections'} · ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}`}
      className="asset-manager cms-manager"
      closeName="Close CMS"
      close={() => {
        if (leave()) close()
      }}
    >
      <div className="cms-layout">
        <nav className="cms-collections" aria-label="Collections">
          <ul>
            {collections.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="cms-collection"
                  aria-current={item === col ? 'page' : undefined}
                  onClick={() => leave() && show({ collection: item.id, tab: 'entries' })}
                >
                  <EditorIcon name="database" />
                  <span>{item.name}</span>
                  <small>{doc.entries[item.id]?.length ?? 0}</small>
                </button>
              </li>
            ))}
          </ul>
          {!readOnly &&
            (creating === undefined ? (
              <button
                type="button"
                className="cms-add"
                disabled={disabled}
                onClick={() => setCreating('')}
              >
                <EditorIcon name="plus" />
                New collection
              </button>
            ) : (
              <form
                className="cms-new-collection"
                onSubmit={(event) => {
                  event.preventDefault()
                  void create()
                }}
              >
                <input
                  aria-label="New collection name"
                  placeholder="e.g. Team members"
                  autoFocus
                  value={creating}
                  onChange={(event) => setCreating(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setCreating(undefined)
                    }
                  }}
                />
                <button type="submit" className="cms-primary" disabled={disabled}>
                  Create
                </button>
              </form>
            ))}
        </nav>
        <section className="cms-main" aria-label={col?.name ?? 'Collections'}>
          <ErrorNote message={error} />
          {col ? (
            <>
              <div className="cms-main-header">
                <h3>{col.name}</h3>
                <div className="cms-tabs" role="tablist" aria-label={`${col.name} views`}>
                  {(['entries', 'fields'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={view.tab === tab}
                      onClick={() => leave() && show({ collection: col.id, tab })}
                    >
                      {tab === 'entries' ? 'Entries' : 'Fields and settings'}
                    </button>
                  ))}
                </div>
              </div>
              {view.tab === 'entries' ? (
                <Entries
                  siteId={siteId}
                  doc={doc}
                  col={col}
                  readOnly={readOnly}
                  disabled={disabled}
                  save={save}
                  undo={undo}
                  upload={upload}
                  open={view.entry}
                  setDirty={setDirty}
                  setOpen={(entry) => setView({ collection: col.id, tab: 'entries', entry })}
                />
              ) : (
                <CollectionSettings
                  key={`${col.id} ${col.name} ${col.slug}`}
                  doc={doc}
                  col={col}
                  readOnly={readOnly}
                  disabled={disabled}
                  save={save}
                  removed={(name) => {
                    setStatus(`Deleted ${name}.`)
                    show({ collection: '', tab: 'entries' })
                  }}
                />
              )}
            </>
          ) : (
            <div className="asset-empty cms-empty">
              <p>
                {readOnly
                  ? 'This site has no collections yet.'
                  : 'A collection holds content that shares its fields, such as blog posts, team members or products. Pages and lists show its entries.'}
              </p>
            </div>
          )}
          {status && (
            <p className="asset-status" role="status">
              {status}
              <button
                type="button"
                className="text-button"
                disabled={disabled}
                onClick={() => {
                  setStatus('')
                  undo()
                }}
              >
                Undo
              </button>
            </p>
          )}
        </section>
      </div>
    </Dialog>
  )
}
