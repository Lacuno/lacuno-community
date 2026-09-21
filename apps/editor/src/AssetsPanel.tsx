import type { Operation } from '@freeflow/document'
import type { AssetRef, Document } from '@freeflow/schema'
import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'

export const imageAssets = (doc: Document) =>
  Object.values(doc.assets).filter((asset) => asset.kind === 'image' || asset.kind === 'svg')
export const assetUrl = (siteId: string, hash: string) => `/api/sites/${siteId}/assets/${hash}`

export async function uploadImage(siteId: string, file: File): Promise<AssetRef> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Images must be 10 MB or smaller.')
  const bitmap = await createImageBitmap(file)
  const width = bitmap.width
  const height = bitmap.height
  bitmap.close()
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1]!)
    reader.onerror = () => reject(new Error('Could not read the image.'))
    reader.readAsDataURL(file)
  })
  const asset = await api<AssetRef>(`/api/sites/${siteId}/assets/upload`, {
    name: file.name,
    data,
  })
  return { ...asset, width, height }
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
  insert: (assetId: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<AssetRef>()
  const saving = useRef(false)
  useEffect(() => {
    if (!pending || disabled || saving.current) return
    if (doc.assets[pending.id]) {
      setPending(undefined)
      return
    }
    saving.current = true
    void save([{ type: 'asset.create', ...pending }]).then((ok) => {
      if (!ok) setError('Could not add the image. Choose the file again to retry.')
      setPending(undefined)
      saving.current = false
    })
  }, [pending, disabled, save, doc])
  return (
    <div className="assets-library">
      <label className="asset-upload">
        Upload image
        <input
          aria-label="Upload image"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          disabled={disabled || loading || !!pending}
          onChange={async (event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (!file) return
            setError('')
            setLoading(true)
            try {
              setPending(await uploadImage(siteId, file))
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not upload image.')
            } finally {
              setLoading(false)
            }
          }}
        />
      </label>
      <p className="hint">PNG, JPEG, WebP or GIF · up to 10 MB</p>
      {(loading || pending) && <p role="status">Adding image…</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!imageAssets(doc).length && (
        <p className="hint">Upload your first image, then drag it onto the page.</p>
      )}
      <div className="asset-grid">
        {imageAssets(doc).map((asset) => (
          <button
            type="button"
            key={asset.id}
            disabled={disabled}
            draggable={!disabled}
            data-drag-preset="image"
            data-drag-asset={asset.id}
            onClick={() => insert(asset.id)}
            title={`Insert ${asset.name}`}
            aria-label={`Insert ${asset.name}`}
          >
            <img src={assetUrl(siteId, asset.hash)} alt="" draggable={false} />
            <span>{asset.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
