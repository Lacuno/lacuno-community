import type { AssetRef } from '@lacuno/schema'
import { fixtureDocument } from '@lacuno/schema'
import { describe, expect, it } from 'vitest'
import { RenderError } from '../src/errors.js'
import {
  type GetImage,
  imageResolverFrom,
  plainImageResolver,
  resolveAllImages,
} from '../src/images.js'

describe('plainImageResolver', () => {
  it('returns correct paths and dimensions for PNG and SVG', () => {
    const png: AssetRef = {
      id: 'a-hero',
      name: 'hero.png',
      hash: 'hero123',
      mime: 'image/png',
      kind: 'image',
      size: 102400,
      width: 1200,
      height: 600,
    }
    expect(plainImageResolver(png)).toEqual({
      src: '/assets/hero123.png',
      width: 1200,
      height: 600,
    })

    const svg: AssetRef = {
      id: 'a-logo',
      name: 'logo.svg',
      hash: 'logo456',
      mime: 'image/svg+xml',
      kind: 'image',
      size: 5120,
    }
    expect(plainImageResolver(svg)).toEqual({
      src: '/assets/logo456.svg',
      width: 0,
      height: 0,
    })
  })
})

const calls: { width: number; widths: number[]; format: string }[] = []
const fakeGetImage: GetImage = async ({ src, width, widths, format }) => {
  calls.push({ width, widths, format })
  return {
    src: `/_astro/${src.src}-${width}.${format}`,
    srcSet: { attribute: widths.map((w) => `/_astro/${src.src}-${w}.${format} ${w}w`).join(', ') },
  }
}

describe('resolveAllImages', () => {
  const doc = fixtureDocument()
  const hero = doc.assets['a-hero']!
  const metas = {
    [`../assets/${hero.hash}.png`]: { src: 'hero', width: 1200, height: 800, format: 'png' },
  }

  it('resolves every image asset as webp with widths up to the original', async () => {
    calls.length = 0
    const images = await resolveAllImages(doc, metas, fakeGetImage)
    expect(images.get('a-hero')).toEqual({
      src: '/_astro/hero-1200.webp',
      srcset:
        '/_astro/hero-320.webp 320w, /_astro/hero-640.webp 640w, /_astro/hero-960.webp 960w, /_astro/hero-1200.webp 1200w',
      width: 1200,
      height: 800,
    })
    expect(calls).toEqual([{ width: 1200, widths: [320, 640, 960, 1200], format: 'webp' }])
  })

  it('stops at the largest width allowed, with the dimensions of that variant', async () => {
    calls.length = 0
    const images = await resolveAllImages(doc, metas, fakeGetImage, 1000)
    expect(images.get('a-hero')).toEqual({
      src: '/_astro/hero-1000.webp',
      srcset: expect.stringMatching(/960w, \/_astro\/hero-1000\.webp 1000w$/),
      width: 1000,
      height: 667,
    })
    expect(calls[0]!.widths).toEqual([320, 640, 960, 1000])
    // An original below the largest width stays at its own.
    calls.length = 0
    await resolveAllImages(doc, metas, fakeGetImage, 1920)
    expect(calls[0]!.widths).toEqual([320, 640, 960, 1200])
  })

  it('fails when an image asset has no metadata', async () => {
    await expect(resolveAllImages(fixtureDocument(), {}, fakeGetImage)).rejects.toThrow(RenderError)
  })

  it('builds a resolver that rejects unknown assets', () => {
    const resolver = imageResolverFrom(new Map())
    expect(() => resolver(fixtureDocument().assets['a-hero']!)).toThrow(
      'no resolved image for a-hero',
    )
  })
})
