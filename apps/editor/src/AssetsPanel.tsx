import type { AssetRef, Document } from '@lacuno/schema'
import { useRef, useState } from 'react'
import { AssetManager } from './AssetManager.js'
import { api, message } from './api.js'
import { ErrorNote } from './Dialog.js'
import type { DocumentSession } from './session.js'

/** Images include SVGs; videos are MP4 and WebM uploads; fonts are WOFF2, WOFF, TTF and OTF. */
export const assetsOfKind = (doc: Document, kind: 'image' | 'video' | 'font' = 'image') =>
  Object.values(doc.assets).filter(
    (asset) => asset.kind === kind || (kind === 'image' && asset.kind === 'svg'),
  )
/** The font files uploads accept, as a file input's accept list and in words. */
export const FONT_ACCEPT = 'font/woff2,font/woff,font/ttf,font/otf,.woff2,.woff,.ttf,.otf'
export const FONT_FORMATS = 'WOFF2, WOFF, TTF or OTF'
/** Every file an upload takes. */
export const ASSET_ACCEPT = `image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,${FONT_ACCEPT}`
export const assetUrl = (siteId: string, hash: string) => `/api/sites/${siteId}/assets/${hash}`

export function AssetPreview({ siteId, asset }: { siteId: string; asset: AssetRef }) {
  return asset.kind === 'video' || asset.kind === 'font' ? (
    <i className="asset-glyph" aria-hidden="true">
      {asset.kind === 'font' ? 'Aa' : '▶'}
    </i>
  ) : (
    <img src={assetUrl(siteId, asset.hash)} alt="" draggable={false} />
  )
}

export async function uploadAsset(siteId: string, file: File): Promise<AssetRef> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Files must be 10 MB or smaller.')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1]!)
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
  const asset = await api<AssetRef>(`/api/sites/${siteId}/assets/upload`, {
    name: file.name,
    data,
  })
  // Browsers often give fonts no type, so size by the kind the server read from the bytes.
  if (asset.kind !== 'image') return asset
  const bitmap = await createImageBitmap(file)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return { ...asset, ...size }
}

export type AssetUploads = ReturnType<typeof useAssetUploads>

/**
 * Uploads files one after another, each registered in its own undoable batch once its bytes are
 * stored. One at a time, since a save refuses to start while another is in flight.
 */
function useAssetUploads(siteId: string, session: DocumentSession) {
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  // The uploads outlive the render that started them, so each write goes through the latest
  // session: the save of an older render commits onto its older revision and is refused.
  const latest = useRef(session)
  latest.current = session
  const queue = useRef(Promise.resolve())
  const upload = (files: File[]) => {
    setError('')
    queue.current = queue.current.then(async () => {
      const failed: string[] = []
      for (const [index, file] of files.entries()) {
        setStatus(
          files.length === 1 ? `Adding ${file.name}…` : `Adding ${index + 1} of ${files.length}…`,
        )
        try {
          const asset = await uploadAsset(siteId, file)
          if (
            !latest.current.doc?.assets[asset.id] &&
            !(await latest.current.save([{ type: 'asset.create', ...asset }]))
          )
            throw new Error('Could not add the file.')
        } catch (err) {
          failed.push(`${file.name}: ${message(err, 'Could not upload the file.')}`)
        }
      }
      setStatus('')
      setError(failed.join(' '))
    })
    return queue.current
  }
  return { upload, status, error }
}

export function AssetsPanel({
  siteId,
  session,
  insert,
  show,
}: {
  siteId: string
  session: DocumentSession
  insert: (preset: 'image' | 'video', assetId: string) => void
  /** Selects an element on the canvas, wherever it lives. */
  show: (node: string) => void
}) {
  const [managing, setManaging] = useState(false)
  const uploads = useAssetUploads(siteId, session)
  const { doc, frozen: disabled, readOnly } = session
  if (!doc) return null
  const assets = [...assetsOfKind(doc), ...assetsOfKind(doc, 'video')]
  const fonts = assetsOfKind(doc, 'font')
  return (
    <>
      <div className="panel-title">
        Assets
        <button
          type="button"
          className="asset-manage"
          aria-haspopup="dialog"
          onClick={() => setManaging(true)}
        >
          Manage
        </button>
      </div>
      {managing && (
        <AssetManager
          siteId={siteId}
          doc={doc}
          readOnly={readOnly}
          disabled={disabled}
          save={session.save}
          undo={() => session.travel('undo')}
          uploads={uploads}
          show={(node) => {
            setManaging(false)
            show(node)
          }}
          close={() => setManaging(false)}
        />
      )}
      <div className="assets-library">
        <label className="asset-upload">
          Upload image, video or font
          <input
            aria-label="Upload image, video or font"
            type="file"
            multiple
            accept={ASSET_ACCEPT}
            disabled={disabled || !!uploads.status}
            onChange={(event) => {
              void uploads.upload([...(event.target.files ?? [])])
              event.target.value = ''
            }}
          />
        </label>
        <p className="hint">PNG, JPEG, WebP, GIF, MP4, WebM, {FONT_FORMATS} · up to 10 MB</p>
        {uploads.status && <p role="status">{uploads.status}</p>}
        {!managing && <ErrorNote message={uploads.error} />}
        {!assets.length && (
          <p className="hint">Upload your first image, then drag it onto the page.</p>
        )}
        <div className="asset-grid">
          {assets.map((asset) => (
            <button
              type="button"
              key={asset.id}
              disabled={disabled}
              draggable={!disabled}
              data-drag-preset={asset.kind === 'video' ? 'video' : 'image'}
              data-drag-asset={asset.id}
              onClick={() => insert(asset.kind === 'video' ? 'video' : 'image', asset.id)}
              title={`Insert ${asset.name}`}
              aria-label={`Insert ${asset.name}`}
            >
              <AssetPreview siteId={siteId} asset={asset} />
              <span>{asset.name}</span>
            </button>
          ))}
          {fonts.map((asset) => (
            <div key={asset.id} className="asset-font" title={asset.name}>
              <AssetPreview siteId={siteId} asset={asset} />
              <span>{asset.name}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
