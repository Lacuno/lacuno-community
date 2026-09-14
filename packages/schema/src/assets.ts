import { z } from 'zod'
import { AssetId } from './ids.js'

/** Metadata only. Bytes live in storage, addressed by content hash. */
export const AssetRef = z.object({
  id: AssetId,
  name: z.string().min(1),
  kind: z.enum(['image', 'video', 'font', 'file', 'svg']),
  hash: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  alt: z.string().optional(),
})
export type AssetRef = z.infer<typeof AssetRef>

export const Font = z.object({
  family: z.string().min(1),
  source: z.enum(['google', 'asset', 'system']),
  asset: AssetId.optional(),
  weights: z.array(z.number().int()).optional(),
  fallback: z.string().optional(),
})
