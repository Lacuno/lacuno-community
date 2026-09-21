import type { Document } from '@freeflow/schema'
import { assetUrl, imageAssets } from './AssetsPanel.js'
import { Dialog } from './Dialog.js'

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
  const assets = imageAssets(doc)
  return (
    <Dialog
      title="Choose an image"
      label="Image library"
      description="Your uploaded photos, ready to reuse."
      className="image-library-dialog"
      close={close}
    >
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
    </Dialog>
  )
}
