import type { AssetRef } from '@freeflow/schema'
import { publicAssetPath } from './assets.js'

export type ResolvedImage = {
  src: string
  srcset?: string
  width: number
  height: number
  /** Extra formats for a <picture> element, best first. */
  sources?: { type: string; srcset: string }[]
}

export type ImageResolver = (asset: AssetRef) => ResolvedImage

/** For tests and dry runs: the asset's public path with no optimization. */
export function plainImageResolver(asset: AssetRef): ResolvedImage {
  return {
    src: publicAssetPath(asset),
    width: asset.width ?? 0,
    height: asset.height ?? 0,
  }
}
