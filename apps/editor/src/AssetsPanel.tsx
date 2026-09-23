import type { Operation } from '@freeflow/document'
import type { AssetRef, Document } from '@freeflow/schema'
import { useState } from 'react'
import { api, message } from './api.js'
import { ErrorNote } from './Dialog.js'

/** Images include SVGs; videos are MP4 and WebM uploads; fonts are WOFF2, WOFF, TTF and OTF. */
export const assetsOfKind = (doc: Document, kind: 'image' | 'video' | 'font' = 'image') =>
  Object.values(doc.assets).filter(
    (asset) => asset.kind === kind || (kind === 'image' && asset.kind === 'svg'),
  )
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

export function AssetsPanel({
  siteId,
  doc,
  disabled,
  save,
  insert,
}: {
  siteId: string
  doc: Document
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
  insert: (preset: 'image' | 'video', assetId: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const assets = [...assetsOfKind(doc), ...assetsOfKind(doc, 'video')]
  const fonts = assetsOfKind(doc, 'font')
  return (
    <div className="assets-library">
      <label className="asset-upload">
        Upload image, video or font
        <input
          aria-label="Upload image, video or font"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,font/woff2,font/woff,font/ttf,font/otf,.woff2,.woff,.ttf,.otf"
          disabled={disabled || loading}
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            setError('')
            setLoading(true)
            try {
              const asset = await uploadAsset(siteId, file)
              if (!doc.assets[asset.id] && !(await save([{ type: 'asset.create', ...asset }])))
                setError('Could not add the file. Choose it again to retry.')
            } catch (err) {
              setError(message(err, 'Could not upload the file.'))
            } finally {
              setLoading(false)
            }
          }}
        />
      </label>
      <p className="hint">PNG, JPEG, WebP, GIF, MP4, WebM, WOFF2, WOFF, TTF or OTF · up to 10 MB</p>
      {loading && <p role="status">Adding file…</p>}
      <ErrorNote message={error} />
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
  )
}
