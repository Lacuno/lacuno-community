import { type AssetRef, type Document, hashAsset } from '@miralo/schema'
import { z } from 'zod'
import type { Persistence } from './persistence.js'
import { kindForMime } from './store.js'

/** An upload's name and base64 bytes, as the editor posts them. */
export const UploadInput = z.object({
  name: z.string().trim().min(1).max(255),
  data: z
    .string()
    .max(14 * 1024 * 1024)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
})

/** Uploads are typed by their first bytes, as hex, never by name or declared type. */
const UPLOAD_SIGNATURES: [RegExp, string][] = [
  [/^89504e470d0a1a0a/, 'image/png'],
  [/^ffd8ff/, 'image/jpeg'],
  [/^474946383[79]61/, 'image/gif'], // GIF87a, GIF89a
  [/^52494646.{8}57454250/, 'image/webp'], // RIFF....WEBP
  [/^.{8}66747970(69736f(6d|32)|6d70343[12]|61766331)/, 'video/mp4'], // ....ftyp isom|iso2|mp41|mp42|avc1
  [/^1a45dfa3/, 'video/webm'],
  [/^774f4632/, 'font/woff2'], // wOF2
  [/^774f4646/, 'font/woff'], // wOFF
  [/^(00010000|74727565)/, 'font/ttf'], // 00 01 00 00, true
  [/^4f54544f/, 'font/otf'], // OTTO
]

/**
 * Checks an upload, stores its bytes and returns the asset for the editor to register in its own
 * revision-checked, undoable batch; an asset already in the document is returned as it is.
 */
export async function stageUpload(
  document: Document,
  persistence: Persistence,
  name: string,
  bytes: Uint8Array,
): Promise<{ status: 200 | 413 | 415; body: AssetRef | { error: string } }> {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024)
    return { status: 413, body: { error: 'Files must be 10 MB or smaller.' } }
  const head = Array.from(bytes.subarray(0, 12), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
  const mime = UPLOAD_SIGNATURES.find(([pattern]) => pattern.test(head))?.[1]
  if (!mime)
    return {
      status: 415,
      body: {
        error:
          'Choose a PNG, JPEG, WebP or GIF image, an MP4 or WebM video, or a WOFF2, WOFF, TTF or OTF font.',
      },
    }
  const hash = await hashAsset(bytes)
  const existing = Object.values(document.assets).find((asset) => asset.hash === hash)
  if (existing) return { status: 200, body: existing }
  await persistence.putAsset(bytes, hash)
  return {
    status: 200,
    body: {
      id: `a-${crypto.randomUUID()}`,
      name,
      kind: kindForMime(mime),
      hash,
      mime,
      size: bytes.length,
    },
  }
}
