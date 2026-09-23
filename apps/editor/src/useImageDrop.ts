import { useRef, useState } from 'react'
import { uploadAsset } from './AssetsPanel.js'
import { message } from './api.js'
import type { DocumentSession } from './session.js'
import { subtreeRestriction } from './structure.js'

type Options = { siteId: string; session: DocumentSession; setSelected: (id: string) => void }

/** Dropping an image onto the canvas uploads it and points the image node at the asset. */
export function useImageDrop({ siteId, session, setSelected }: Options) {
  const { doc, save, setError, flushPending } = session
  const [uploadingImage, setUploadingImage] = useState(false)
  // The upload outlives the render that started it, so the write reads the document back.
  const latest = useRef({ doc, save })
  latest.current = { doc, save }
  async function dropImage(id: string, file: File) {
    if (uploadingImage) return
    setUploadingImage(true)
    setError('')
    try {
      if (!file.type.startsWith('image/')) throw new Error('Drop an image file here.')
      const asset = await uploadAsset(siteId, file)
      if (!(await flushPending())) return
      const { doc: current, save: write } = latest.current
      const node = current?.nodes[id]
      if (
        !current ||
        node?.type !== 'element' ||
        node.tag !== 'img' ||
        subtreeRestriction(current, id)
      ) {
        setError('This image can no longer be changed.')
        return
      }
      const ok = await write([
        ...(!current.assets[asset.id] ? [{ type: 'asset.create' as const, ...asset }] : []),
        {
          type: 'node.update',
          id,
          attrs: { ...node.attrs, src: { type: 'asset', asset: asset.id } },
        },
      ])
      if (ok) setSelected(id)
    } catch (error) {
      setError(message(error, 'Could not upload image.'))
    } finally {
      setUploadingImage(false)
    }
  }
  return { uploadingImage, dropImage }
}
