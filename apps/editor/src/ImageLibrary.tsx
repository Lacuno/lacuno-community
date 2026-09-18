import type { Document } from '@freeflow/schema'
import { useEffect, useRef } from 'react'
import { assetUrl, imageAssets } from './AssetsPanel.js'

export function ImageLibrary({
  siteId,
  doc,
  selected,
  choose,
  close,
}: {
  siteId: string
  doc: Document
  selected: string
  choose: (id: string) => void
  close: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  const assets = imageAssets(doc)
  return (
    <dialog
      ref={dialog}
      className="image-library-dialog"
      aria-label="Image library"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header>
        <div>
          <h2>Choose an image</h2>
          <p>Your uploaded photos, ready to reuse.</p>
        </div>
        <button type="button" onClick={close}>
          Close
        </button>
      </header>
      {!assets.length && (
        <p className="hint">
          No images yet. Drop a photo onto the placeholder, or upload one in Assets.
        </p>
      )}
      <div className="asset-grid">
        {assets.map((asset) => (
          <button
            type="button"
            key={asset.id}
            aria-label={`Choose ${asset.name}`}
            aria-pressed={selected === asset.id}
            onClick={() => choose(asset.id)}
          >
            <img src={assetUrl(siteId, asset.hash)} alt="" />
            <span>{asset.name}</span>
          </button>
        ))}
      </div>
    </dialog>
  )
}
