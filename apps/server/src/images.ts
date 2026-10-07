import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { IMAGE_WIDTHS } from '@lacuno/compiler'
import { writeAtomic } from '@lacuno/document/folder'
import type { AssetRef } from '@lacuno/schema'

/** Loaded on first use, with one thread and no cache: the runtime has one CPU and little memory. */
let loading: Promise<typeof import('sharp').default> | undefined
const sharp = () =>
  (loading ??= import('sharp').then(({ default: sharp }) => {
    sharp.concurrency(1)
    sharp.cache(false)
    return sharp
  }))

/** One resize at a time, so a page of thumbnails does not decode every original at once. */
let queue: Promise<unknown> = Promise.resolve()

/** A raster image's size as it displays, EXIF orientation applied; nothing for bytes sharp cannot read. */
export async function imageSize(
  bytes: Uint8Array,
): Promise<{ width: number; height: number } | undefined> {
  try {
    const { width, height } = (await (await sharp())(bytes).metadata()).autoOrient
    return { width, height }
  } catch {
    return undefined
  }
}

/** The formats sharp resizes; the editor measures these and lists their variants. */
export const RESIZABLE = new Set(['image/png', 'image/jpeg', 'image/webp'])

const variantFile = (siteDir: string, hash: string, width: number) =>
  path.join(siteDir, 'cache', 'images', `${hash}-${width}.webp`)

/**
 * The asset as a WebP `width` pixels wide, resized once and kept under the site's cache/images.
 * Nothing where the original serves: another format, a width at or above the image's own, or
 * bytes sharp cannot decode. A missing original throws like reading it would.
 */
export async function imageVariant(
  siteDir: string,
  asset: AssetRef,
  width: number,
): Promise<Buffer | undefined> {
  if (!RESIZABLE.has(asset.mime)) return undefined
  const file = variantFile(siteDir, asset.hash, width)
  const cached = await readFile(file).catch(() => undefined)
  if (cached) return cached
  const original = await readFile(path.join(siteDir, 'assets', asset.hash))
  const resized = queue
    .then(async () => {
      const image = (await sharp())(original).autoOrient()
      if ((await image.metadata()).autoOrient.width <= width) return undefined
      return image.resize({ width }).webp({ quality: 80 }).toBuffer()
    })
    .catch(() => undefined)
  queue = resized
  const bytes = await resized
  if (!bytes) return undefined
  await mkdir(path.dirname(file), { recursive: true })
  await writeAtomic(file, bytes)
  return bytes
}

/** Removes an image's variants, once no asset of the site carries its hash. */
export const forgetVariants = (siteDir: string, hash: string) =>
  Promise.all(IMAGE_WIDTHS.map((width) => rm(variantFile(siteDir, hash, width), { force: true })))
