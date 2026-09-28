import type { Operation } from '@lacuno/document'
import type { AssetRef, Document } from '@lacuno/schema'
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ASSET_ACCEPT, type AssetUploads, assetUrl } from './AssetsPanel.js'
import {
  type AssetSort,
  type AssetUse,
  assetType,
  assetUses,
  fileSize,
  listAssets,
} from './assets.js'
import { Dialog, ErrorNote } from './Dialog.js'
import './assets.css'

/** A font asset as a type specimen: the file is loaded as a face under its own family name. */
function FontSpecimen({ siteId, asset }: { siteId: string; asset: AssetRef }) {
  const family = `lacuno-asset-${asset.hash.slice(0, 16)}`
  useEffect(() => {
    const face = new FontFace(family, `url(${assetUrl(siteId, asset.hash)})`)
    document.fonts.add(face)
    face.load().catch(() => {})
  }, [siteId, asset.hash, family])
  return (
    <span className="asset-specimen" style={{ fontFamily: `"${family}", system-ui` }}>
      Aa
    </span>
  )
}

/** A large preview: images drawn, a video's first frame, a font's specimen, else the format. */
function Preview({
  siteId,
  asset,
  measure,
}: {
  siteId: string
  asset: AssetRef
  measure?: (size: [number, number]) => void
}) {
  const url = assetUrl(siteId, asset.hash)
  if (asset.kind === 'image' || asset.kind === 'svg')
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        draggable={false}
        onLoad={(event) =>
          measure?.([event.currentTarget.naturalWidth, event.currentTarget.naturalHeight])
        }
      />
    )
  if (asset.kind === 'video')
    return (
      <video
        src={`${url}#t=0.1`}
        preload="metadata"
        muted
        playsInline
        onLoadedMetadata={(event) =>
          measure?.([event.currentTarget.videoWidth, event.currentTarget.videoHeight])
        }
      />
    )
  if (asset.kind === 'font') return <FontSpecimen siteId={siteId} asset={asset} />
  return <span className="asset-badge">{assetType(asset)}</span>
}

function Details({
  siteId,
  asset,
  uses,
  readOnly,
  disabled,
  save,
  show,
  remove,
}: {
  siteId: string
  asset: AssetRef
  uses: AssetUse[]
  readOnly: boolean
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
  show: (node: string) => void
  remove: () => void
}) {
  const [alt, setAlt] = useState(asset.alt ?? '')
  const [measured, setMeasured] = useState<[number, number]>()
  const size = asset.width && asset.height ? [asset.width, asset.height] : measured
  const saveAlt = () => {
    if (alt.trim() !== (asset.alt ?? ''))
      void save([{ type: 'asset.update', id: asset.id, alt: alt.trim() || null }])
  }
  return (
    <>
      <div className="asset-details-preview">
        <Preview siteId={siteId} asset={asset} measure={setMeasured} />
      </div>
      <h3 className="asset-details-name">{asset.name}</h3>
      <dl className="asset-facts">
        <dt>Type</dt>
        <dd>{assetType(asset)}</dd>
        {size && (
          <>
            <dt>Dimensions</dt>
            <dd>
              {size[0]} × {size[1]}
            </dd>
          </>
        )}
        <dt>Size</dt>
        <dd>{fileSize(asset.size)}</dd>
      </dl>
      {(asset.kind === 'image' || asset.kind === 'svg') && (
        <label className="asset-alt">
          Default alt text
          <input
            value={alt}
            readOnly={readOnly}
            disabled={disabled && !readOnly}
            placeholder={readOnly ? 'None' : 'Describe the image'}
            onChange={(event) => setAlt(event.target.value)}
            onBlur={saveAlt}
            onKeyDown={(event) => {
              if (event.key === 'Enter') saveAlt()
            }}
          />
        </label>
      )}
      <h4 className="asset-uses-heading">{uses.length ? `Used in ${uses.length}` : 'Not used'}</h4>
      {uses.length > 0 && (
        <ul className="asset-uses">
          {uses.map((use) => (
            <li key={`${use.node ?? use.place}-${use.label}`}>
              {use.node ? (
                <button
                  type="button"
                  aria-label={`Show ${use.label} on ${use.place}`}
                  onClick={() => show(use.node!)}
                >
                  <span>{use.label}</span>
                  <small>{use.place}</small>
                </button>
              ) : (
                <div>
                  <span>{use.label}</span>
                  <small>{use.place}</small>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly &&
        (uses.length ? (
          <p className="asset-kept">Remove it from these places to delete it.</p>
        ) : (
          <button type="button" className="asset-delete" disabled={disabled} onClick={remove}>
            Delete file
          </button>
        ))}
    </>
  )
}

/** Every file of the site in one place: preview, details, where each is used, upload and delete. */
export function AssetManager({
  siteId,
  doc,
  readOnly,
  disabled,
  save,
  undo,
  uploads,
  show,
  close,
}: {
  siteId: string
  doc: Document
  /** A viewer's session: everything is shown, nothing can change. */
  readOnly: boolean
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
  undo: () => void
  uploads: AssetUploads
  show: (node: string) => void
  close: () => void
}) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<AssetSort>('newest')
  const [current, setCurrent] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [deleted, setDeleted] = useState('')
  const [dragging, setDragging] = useState(false)
  const grid = useRef<HTMLDivElement>(null)
  const assets = listAssets(doc, search, sort)
  const uses = useMemo(
    () => Object.fromEntries(Object.keys(doc.assets).map((id) => [id, assetUses(doc, id)])),
    [doc],
  )
  const focused = doc.assets[current] ? current : (assets[0]?.id ?? '')
  const chosen = selected.filter((id) => doc.assets[id])
  const deletable = chosen.filter((id) => !uses[id]?.length)
  const total = Object.values(doc.assets).reduce((sum, asset) => sum + asset.size, 0)
  const count = Object.keys(doc.assets).length
  const detail = chosen.length <= 1 ? doc.assets[chosen[0] ?? focused] : undefined

  const pick = (id: string, add: boolean) => {
    setCurrent(id)
    setConfirming(false)
    setDeleted('')
    setSelected((list) =>
      add ? (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]) : [id],
    )
  }
  const focus = (id: string) =>
    grid.current?.querySelector<HTMLElement>(`[data-asset="${CSS.escape(id)}"]`)?.focus()
  // Only files nothing uses can be deleted; a used one lists where it is used instead.
  const askDelete = (ids: string[]) => {
    if (readOnly || ids.every((id) => uses[id]?.length)) return
    setSelected(ids)
    setConfirming(true)
  }
  async function remove(ids: string[]) {
    const names = ids.map((id) => doc.assets[id]?.name ?? id)
    const index = assets.findIndex((asset) => asset.id === ids[0])
    if (!(await save(ids.map((id) => ({ type: 'asset.delete', id }))))) return
    setConfirming(false)
    setSelected([])
    setDeleted(names.length === 1 ? `Deleted ${names[0]}.` : `Deleted ${names.length} files.`)
    const next = assets.filter((asset) => !ids.includes(asset.id))[Math.max(0, index)]
    setCurrent(next?.id ?? '')
    if (next) requestAnimationFrame(() => focus(next.id))
  }
  function onGridKey(event: KeyboardEvent) {
    const index = assets.findIndex((asset) => asset.id === focused)
    const columns = grid.current
      ? getComputedStyle(grid.current).gridTemplateColumns.split(' ').length
      : 1
    const step = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns,
      Home: -index,
      End: assets.length - 1 - index,
    }[event.key]
    if (step !== undefined) {
      event.preventDefault()
      const next = assets[Math.min(assets.length - 1, Math.max(0, index + step))]
      if (next) {
        pick(next.id, false)
        focus(next.id)
      }
    } else if (event.key === ' ' && focused) {
      event.preventDefault()
      pick(focused, true)
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && !disabled) {
      event.preventDefault()
      askDelete(chosen.length ? chosen : [focused])
    }
  }
  const upload = (files: FileList | null | undefined) => {
    if (!readOnly && files?.length) void uploads.upload([...files])
  }
  return (
    <Dialog
      title="Assets"
      description={`${count} ${count === 1 ? 'file' : 'files'} · ${fileSize(total)}`}
      className="asset-manager"
      closeName="Close assets"
      close={() => (confirming ? setConfirming(false) : close())}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a drop zone; the Upload button is its keyboard path. */}
      <div
        className="asset-manager-body"
        data-file-drop
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          if (readOnly) event.dataTransfer.dropEffect = 'none'
          else setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          upload(event.dataTransfer.files)
        }}
      >
        <div className="asset-toolbar">
          <input
            type="search"
            aria-label="Search assets"
            placeholder="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            aria-label="Sort assets"
            value={sort}
            onChange={(event) => setSort(event.target.value as AssetSort)}
          >
            <option value="newest">Newest</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
          {!readOnly && (
            <button
              type="button"
              disabled={!assets.some((asset) => !uses[asset.id]?.length)}
              onClick={() => {
                setConfirming(false)
                setSelected(assets.filter((asset) => !uses[asset.id]?.length).map((a) => a.id))
              }}
            >
              Select unused
            </button>
          )}
          {(uploads.status || deleted) && (
            <p className="asset-status" role="status">
              {uploads.status || deleted}
              {!uploads.status && (
                <button
                  type="button"
                  className="text-button"
                  disabled={disabled}
                  onClick={() => {
                    setDeleted('')
                    undo()
                  }}
                >
                  Undo
                </button>
              )}
            </p>
          )}
          {!readOnly && (
            <label className="asset-upload-button" data-disabled={disabled || !!uploads.status}>
              Upload
              <input
                type="file"
                multiple
                aria-label="Upload files"
                accept={ASSET_ACCEPT}
                disabled={disabled || !!uploads.status}
                onChange={(event) => {
                  upload(event.target.files)
                  event.target.value = ''
                }}
              />
            </label>
          )}
        </div>
        <ErrorNote message={uploads.error} />
        <div className="asset-manager-layout">
          {assets.length ? (
            <div
              ref={grid}
              className="asset-tiles"
              role="listbox"
              aria-label="Files"
              aria-multiselectable="true"
              data-multi={chosen.length > 1}
              tabIndex={-1}
              onKeyDown={onGridKey}
            >
              {assets.map((asset) => {
                const used = uses[asset.id]?.length ?? 0
                const isSelected = chosen.length ? chosen.includes(asset.id) : asset.id === focused
                return (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles the keys for its options.
                  <div
                    key={asset.id}
                    data-asset={asset.id}
                    role="option"
                    tabIndex={asset.id === focused ? 0 : -1}
                    aria-selected={isSelected}
                    aria-label={`${asset.name}, ${assetType(asset)}, ${used ? `used in ${used}` : 'not used'}`}
                    className="asset-tile"
                    onClick={(event) =>
                      pick(asset.id, event.metaKey || event.ctrlKey || event.shiftKey)
                    }
                  >
                    <div className="asset-tile-preview">
                      <Preview siteId={siteId} asset={asset} />
                      {!readOnly && (
                        <span
                          className="asset-check"
                          aria-hidden="true"
                          data-checked={chosen.includes(asset.id)}
                          onClick={(event) => {
                            event.stopPropagation()
                            pick(asset.id, true)
                          }}
                        />
                      )}
                    </div>
                    <span className="asset-tile-name">{asset.name}</span>
                    <span className="asset-tile-meta">
                      {fileSize(asset.size)}
                      {!used && <em>Not used</em>}
                    </span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="asset-empty">
              <p>
                {count
                  ? 'No file matches your search.'
                  : readOnly
                    ? 'This site has no files yet.'
                    : 'No files yet. Drop images, videos or fonts here to upload them.'}
              </p>
            </div>
          )}
          <aside className="asset-details" aria-label="File details">
            {confirming && deletable.length ? (
              <div className="asset-confirm" role="alertdialog" aria-label="Confirm delete">
                <p>
                  {deletable.length === 1
                    ? `Delete ${doc.assets[deletable[0]!]!.name}?`
                    : `Delete ${deletable.length} files?`}
                </p>
                {deletable.length > 1 && (
                  <ul className="asset-confirm-names">
                    {deletable.map((id) => (
                      <li key={id}>{doc.assets[id]!.name}</li>
                    ))}
                  </ul>
                )}
                {deletable.length < chosen.length && (
                  <p className="asset-kept">
                    {chosen.length - deletable.length} in use{' '}
                    {chosen.length - deletable.length === 1 ? 'stays' : 'stay'}.
                  </p>
                )}
                <div className="asset-confirm-actions">
                  <button
                    type="button"
                    className="asset-delete"
                    // biome-ignore lint/a11y/noAutofocus: the confirm step takes the focus it asks for.
                    autoFocus
                    disabled={disabled}
                    onClick={() => void remove(deletable)}
                  >
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : detail ? (
              <Details
                key={detail.id}
                siteId={siteId}
                asset={detail}
                uses={uses[detail.id] ?? []}
                readOnly={readOnly}
                disabled={disabled}
                save={save}
                show={show}
                remove={() => askDelete([detail.id])}
              />
            ) : chosen.length > 1 ? (
              <div className="asset-multi">
                <h3>{chosen.length} files selected</h3>
                <p>
                  {deletable.length} not used
                  {chosen.length > deletable.length &&
                    `, ${chosen.length - deletable.length} in use`}{' '}
                  · {fileSize(chosen.reduce((sum, id) => sum + doc.assets[id]!.size, 0))}
                </p>
                <div className="asset-confirm-actions">
                  {!readOnly && (
                    <button
                      type="button"
                      className="asset-delete"
                      disabled={disabled || !deletable.length}
                      onClick={() => askDelete(chosen)}
                    >
                      {deletable.length === chosen.length
                        ? `Delete ${deletable.length} files`
                        : `Delete ${deletable.length} unused`}
                    </button>
                  )}
                  <button type="button" onClick={() => setSelected([])}>
                    Clear selection
                  </button>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
        {dragging && (
          <div className="asset-drop" aria-hidden="true">
            Drop to upload
          </div>
        )}
      </div>
    </Dialog>
  )
}
