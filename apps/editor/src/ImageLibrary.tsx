import type { Document } from '@miralo/schema'
import { AssetPreview, assetsOfKind } from './AssetsPanel.js'
import { Dialog } from './Dialog.js'

export function ImageLibrary({
  siteId,
  doc,
  selected,
  kind = 'image',
  choose,
  close,
}: {
  siteId: string
  doc: Document
  selected: string
  kind?: 'image' | 'video'
  choose: (id: string) => void
  close: () => void
}) {
  const assets = assetsOfKind(doc, kind)
  return (
    <Dialog
      title={`Choose ${kind === 'video' ? 'a video' : 'an image'}`}
      label={kind === 'video' ? 'Video library' : 'Image library'}
      description={`Your uploaded ${kind === 'video' ? 'videos' : 'photos'}, ready to reuse.`}
      className="image-library-dialog"
      close={close}
    >
      {!assets.length && (
        <p className="hint">
          {kind === 'video'
            ? 'No videos yet. Upload an MP4 or WebM in Assets.'
            : 'No images yet. Drop a photo onto the placeholder, or upload one in Assets.'}
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
            <AssetPreview siteId={siteId} asset={asset} />
            <span>{asset.name}</span>
          </button>
        ))}
      </div>
    </Dialog>
  )
}
