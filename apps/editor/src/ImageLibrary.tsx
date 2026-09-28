import type { Document } from '@lacuno/schema'
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
  /** `file` offers every asset. */
  kind?: 'image' | 'video' | 'file'
  choose: (id: string) => void
  close: () => void
}) {
  const assets = kind === 'file' ? Object.values(doc.assets) : assetsOfKind(doc, kind)
  const noun = {
    image: ['an image', 'Image', 'photos'],
    video: ['a video', 'Video', 'videos'],
    file: ['a file', 'File', 'files'],
  }[kind]
  return (
    <Dialog
      title={`Choose ${noun[0]}`}
      label={`${noun[1]} library`}
      description={`Your uploaded ${noun[2]}, ready to reuse.`}
      className="image-library-dialog"
      close={close}
    >
      {!assets.length && (
        <p className="hint">
          {kind === 'video'
            ? 'No videos yet. Upload an MP4 or WebM in Assets.'
            : kind === 'file'
              ? 'No files yet. Upload one in Assets.'
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
