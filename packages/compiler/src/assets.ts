import type { AssetRef } from '@lacuno/schema'

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'application/pdf': 'pdf',
}

export function extensionForMime(mime: string): string {
  return EXT[mime] ?? 'bin'
}

/** `<hash>.<ext>`: the name under which an asset is copied into the scaffold. */
export function assetFileName(asset: AssetRef): string {
  return `${asset.hash}.${extensionForMime(asset.mime)}`
}

/** URL of a non-image asset in the published site. */
export function publicAssetPath(asset: AssetRef): string {
  return `/assets/${assetFileName(asset)}`
}

/** Images, the assets Astro optimizes. Everything else is copied to public/ as it is. */
export function isImage(asset: AssetRef): boolean {
  return asset.kind === 'image'
}
