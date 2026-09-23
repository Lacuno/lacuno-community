import type { Operation } from '@freeflow/document'
import { useState } from 'react'
import { ImageLibrary } from './ImageLibrary.js'
import { toggleAttr } from './structure.js'
import type { StyleControls } from './styleField.js'

/** An image's or video's file, an image's alt text, fit and focal point, and a video's flags. */
export function MediaControls({
  siteId,
  alt,
  setAlt,
  asset,
  setAsset,
  autoSave,
  doc,
  node,
  disabled,
  changes,
  computed,
  change,
}: StyleControls & {
  siteId: string
  alt: string
  setAlt: (alt: string) => void
  asset: string
  setAsset: (asset: string) => void
  autoSave: (ops: Operation[]) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const isVideo = node.type === 'element' && node.tag === 'video'
  return (
    <div className="image-controls">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {`${asset ? 'Change' : 'Choose'} ${isVideo ? 'video' : 'image'}`}
      </button>
      {open && (
        <ImageLibrary
          siteId={siteId}
          doc={doc}
          kind={isVideo ? 'video' : 'image'}
          selected={asset}
          close={() => setOpen(false)}
          choose={(id) => {
            setAsset(id)
            setOpen(false)
          }}
        />
      )}
      {isVideo ? (
        <div className="video-flags">
          {['controls', 'autoplay', 'loop', 'muted'].map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                disabled={disabled}
                checked={node.attrs?.[name]?.type === 'static' && node.attrs[name].value === true}
                onChange={(event) => void autoSave([toggleAttr(node, name, event.target.checked)])}
              />
              {name[0]!.toUpperCase() + name.slice(1)}
            </label>
          ))}
        </div>
      ) : (
        <>
          <label>
            Alt text
            <input
              aria-label="Image alt text"
              value={alt}
              disabled={disabled}
              onChange={(event) => setAlt(event.target.value)}
            />
          </label>
          <p className="hint">Describe the image, or leave empty if it is decorative.</p>
          <label>
            Fit
            <select
              aria-label="Image fit"
              disabled={disabled}
              value={
                changes['object-fit']?.type === 'raw'
                  ? changes['object-fit'].value
                  : computed['object-fit'] || 'fill'
              }
              onChange={(event) => change('object-fit', { type: 'raw', value: event.target.value })}
            >
              {Object.entries({
                cover: 'Fill frame',
                contain: 'Fit inside',
                fill: 'Stretch',
                none: 'Original size',
                'scale-down': 'Shrink to fit',
              }).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Focal point
            <select
              aria-label="Image focal point"
              disabled={disabled}
              value={
                changes['object-position']?.type === 'raw'
                  ? changes['object-position'].value
                  : computed['object-position'] || '50% 50%'
              }
              onChange={(event) =>
                change('object-position', {
                  type: 'raw',
                  value: event.target.value,
                })
              }
            >
              {[
                ['0% 0%', 'Top left'],
                ['50% 0%', 'Top'],
                ['100% 0%', 'Top right'],
                ['0% 50%', 'Left'],
                ['50% 50%', 'Center'],
                ['100% 50%', 'Right'],
                ['0% 100%', 'Bottom left'],
                ['50% 100%', 'Bottom'],
                ['100% 100%', 'Bottom right'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  )
}
