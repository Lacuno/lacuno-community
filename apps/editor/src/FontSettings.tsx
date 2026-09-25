import type { Operation } from '@lacuno/document'
import type { Document, Font } from '@lacuno/schema'
import { useState } from 'react'
import { FONT_ACCEPT, FONT_FORMATS, uploadAsset } from './AssetsPanel.js'
import { message } from './api.js'
import { ErrorNote } from './Dialog.js'
import { faceFromFileName, faceLabel, setFallback, WEIGHT_NAMES } from './fonts.js'

/** Weight options from 100 Thin to 900 Black, those that pass keep. */
const weightOptions = (keep: (weight: number) => boolean) =>
  WEIGHT_NAMES.map(
    (name, i) =>
      keep((i + 1) * 100) && (
        <option key={name} value={(i + 1) * 100}>
          {(i + 1) * 100} {name}
        </option>
      ),
  )

/**
 * The site's font faces grouped by family, each face removable and the fallback saved on blur,
 * plus the forms that add an uploaded face or a system font. Every change writes the whole list.
 */
export function FontSettings({
  doc,
  siteId,
  write,
}: {
  doc: Document
  siteId: string
  write: (key: string, operations: Operation[]) => Promise<boolean>
}) {
  const { fonts } = doc.site
  const [face, setFace] = useState<Font | null>(null)
  const range = face?.weightRange
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const save = (next: Font[]) => write('fonts', [{ type: 'site.update', fonts: next }])
  const fallbackOf = (family: string) =>
    fonts.find((f) => f.family === family)?.fallback ?? 'sans-serif'
  return (
    <>
      <h3>Fonts</h3>
      <ul className="font-list">
        {[...new Set(fonts.map((f) => f.family))].map((family) => (
          <li key={family}>
            <strong>{family}</strong>
            <span className="font-faces">
              {fonts.map(
                (font, index) =>
                  font.family === family && (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a face has no id; its place is its identity
                    <span key={index} className="font-face">
                      {faceLabel(font)}
                      {font.source === 'asset' && !doc.assets[font.asset ?? ''] && (
                        <em>File missing</em>
                      )}
                      <button
                        type="button"
                        aria-label={`Remove ${family} ${faceLabel(font)}`}
                        onClick={() => void save(fonts.filter((_, i) => i !== index))}
                      >
                        ×
                      </button>
                    </span>
                  ),
              )}
            </span>
            <input
              key={fallbackOf(family)}
              aria-label={`${family} fallback`}
              defaultValue={fallbackOf(family)}
              onBlur={(event) => {
                const fallback = event.target.value.trim()
                if (fallback !== fallbackOf(family)) void save(setFallback(fonts, family, fallback))
              }}
            />
          </li>
        ))}
      </ul>
      {face ? (
        <form
          className="font-form"
          onSubmit={async (event) => {
            event.preventDefault()
            const added = {
              ...face,
              family: face.family.trim(),
              fallback: face.fallback?.trim() || undefined,
            }
            if (await save([...fonts, added])) setFace(null)
          }}
        >
          <label>
            Family
            <input
              required
              value={face.family}
              onChange={(event) => setFace({ ...face, family: event.target.value })}
            />
          </label>
          {face.source === 'asset' && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={!!face.weightRange}
                  onChange={(event) =>
                    setFace(
                      event.target.checked
                        ? { ...face, weight: undefined, weightRange: [100, 900] }
                        : { ...face, weight: 400, weightRange: undefined },
                    )
                  }
                />
                Variable font
              </label>
              {range ? (
                <>
                  <label>
                    From
                    <select
                      aria-label="From"
                      value={range[0]}
                      onChange={(event) =>
                        setFace({
                          ...face,
                          weightRange: [Number(event.target.value), range[1]],
                        })
                      }
                    >
                      {weightOptions((weight) => weight < range[1])}
                    </select>
                  </label>
                  <label>
                    To
                    <select
                      aria-label="To"
                      value={range[1]}
                      onChange={(event) =>
                        setFace({
                          ...face,
                          weightRange: [range[0], Number(event.target.value)],
                        })
                      }
                    >
                      {weightOptions((weight) => weight > range[0])}
                    </select>
                  </label>
                </>
              ) : (
                <label>
                  Weight
                  <select
                    aria-label="Weight"
                    value={face.weight}
                    onChange={(event) => setFace({ ...face, weight: Number(event.target.value) })}
                  >
                    {weightOptions(() => true)}
                  </select>
                </label>
              )}
              <label>
                Style
                <select
                  aria-label="Style"
                  value={face.style}
                  onChange={(event) =>
                    setFace({ ...face, style: event.target.value as Font['style'] })
                  }
                >
                  <option value="normal">Regular</option>
                  <option value="italic">Italic</option>
                </select>
              </label>
            </>
          )}
          <label>
            Fallback
            <input
              value={face.fallback ?? ''}
              onChange={(event) => setFace({ ...face, fallback: event.target.value })}
            />
          </label>
          <button type="submit">Add</button>
          <button type="button" onClick={() => setFace(null)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="font-actions">
          <label className="asset-upload">
            Add font
            <input
              aria-label="Upload font"
              type="file"
              accept={FONT_ACCEPT}
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                setError('')
                setUploading(true)
                try {
                  const asset = await uploadAsset(siteId, file)
                  if (asset.kind !== 'font') throw new Error(`Choose a ${FONT_FORMATS} font.`)
                  if (
                    doc.assets[asset.id] ||
                    (await write('fonts', [{ type: 'asset.create', ...asset }]))
                  ) {
                    const prefill = faceFromFileName(file.name)
                    setFace({
                      source: 'asset',
                      asset: asset.id,
                      ...prefill,
                      fallback: fallbackOf(prefill.family),
                    })
                  }
                } catch (err) {
                  setError(message(err, 'Could not upload the font.'))
                } finally {
                  setUploading(false)
                }
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => setFace({ family: '', source: 'system', fallback: 'sans-serif' })}
          >
            Add system font
          </button>
        </div>
      )}
      {uploading && <p role="status">Uploading font…</p>}
      <ErrorNote message={error} />
    </>
  )
}
