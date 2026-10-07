import type { AssetRef, Document } from '@lacuno/schema'
import { assetFileName, isImage, publicAssetPath } from './assets.js'
import { RenderError } from './errors.js'

export type ResolvedImage = {
  src: string
  srcset?: string
  width: number
  height: number
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

/** What Astro's `import.meta.glob` yields for an image under src/assets. */
export type ImageMeta = { src: string; width: number; height: number; format: string }

/** The shape of `getImage` from `astro:assets` as the route calls it. */
export type GetImage = (options: {
  src: ImageMeta
  width: number
  widths: number[]
  format: 'webp'
}) => Promise<{ src: string; srcSet: { attribute: string } }>

export const IMAGE_WIDTHS = [320, 640, 960, 1280, 1920]

/**
 * Optimizes every image asset once per build: WebP at the widths below its largest variant and at
 * that, the original's width or `maxWidth` when that is smaller. AVIF was weighed and left out: a
 * 12-megapixel photo took 30 s and half a gigabyte on one core, fifteen times WebP. Keys of `metas`
 * are matched by basename.
 */
export async function resolveAllImages(
  doc: Document,
  metas: Record<string, unknown>,
  getImage: GetImage,
  maxWidth?: number,
): Promise<Map<string, ResolvedImage>> {
  const byName = new Map<string, ImageMeta>()
  for (const [key, meta] of Object.entries(metas)) {
    byName.set(key.split('/').pop() ?? key, meta as ImageMeta)
  }
  const out = new Map<string, ResolvedImage>()
  for (const asset of Object.values(doc.assets)) {
    if (!isImage(asset)) continue
    const meta = byName.get(assetFileName(asset))
    if (!meta)
      throw new RenderError(`image ${asset.id} (${asset.name}) was not copied into the scaffold`)
    const largest = Math.min(meta.width, maxWidth ?? meta.width)
    const webp = await getImage({
      src: meta,
      width: largest,
      widths: [...IMAGE_WIDTHS.filter((w) => w < largest), largest],
      format: 'webp',
    })
    out.set(asset.id, {
      src: webp.src,
      srcset: webp.srcSet.attribute,
      width: largest,
      height: Math.round((meta.height * largest) / meta.width),
    })
  }
  return out
}

export function imageResolverFrom(images: Map<string, ResolvedImage>): ImageResolver {
  return (asset) => {
    const img = images.get(asset.id)
    if (!img) throw new RenderError(`no resolved image for ${asset.id}`)
    return img
  }
}
