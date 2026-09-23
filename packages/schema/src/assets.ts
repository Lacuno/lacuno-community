import { z } from 'zod'
import { AssetId } from './ids.js'

/**
 * Content hash of an asset's bytes: lower-case SHA-256 hex. It is the asset's storage key and
 * its file name in builds, so every producer must use hashAsset() and nothing else.
 */
export const AssetHash = z.string().regex(/^[a-f0-9]{64}$/, 'asset hash must be sha256 hex')
export type AssetHash = z.infer<typeof AssetHash>

/** SHA-256 of the bytes as lower-case hex. Web Crypto, so it runs in Node and browsers. */
export async function hashAsset(bytes: Uint8Array): Promise<AssetHash> {
  // Copy into a plain ArrayBuffer so views over shared or offset buffers hash correctly.
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Metadata only. Bytes live in storage, addressed by content hash. */
export const AssetRef = z.object({
  id: AssetId,
  name: z.string().min(1),
  kind: z.enum(['image', 'video', 'font', 'file', 'svg']),
  hash: AssetHash,
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  alt: z.string().optional(),
})
export type AssetRef = z.infer<typeof AssetRef>

/**
 * Fonts are self-hosted (`asset`) or system stacks (`system`). There is deliberately no hosted
 * provider option: a font loaded from a third party sends every visitor's IP address to that
 * party, which the Munich Regional Court ruled a GDPR violation for Google Fonts in 2022. See D013.
 */
export const Font = z.strictObject({
  family: z.string().min(1),
  source: z.enum(['asset', 'system']),
  asset: AssetId.optional(),
  /** One entry is one face: several entries share a family. Missing means 400 and normal. */
  weight: z.number().int().min(100).max(900).multipleOf(100).optional(),
  style: z.enum(['normal', 'italic']).optional(),
  /** Families to fall back to. The editor writes it after the family in font-family values. */
  fallback: z.string().optional(),
})
export type Font = z.infer<typeof Font>
