import type { AssetRef } from '@miralo/schema'
import { fixtureDocument } from '@miralo/schema'
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

const calls: { widths: number[]; format: string }[] = []
const fakeGetImage: GetImage = async ({ src, widths, format }) => {
  calls.push({ widths, format })
  return {
    src: `/_astro/${src.src}.${format}`,
    srcSet: { attribute: widths.map((w) => `/_astro/${src.src}-${w}.${format} ${w}w`).join(', ') },
  }
}

describe('resolveAllImages', () => {
  it('resolves every image asset in avif and webp with widths up to the original', async () => {
    const doc = fixtureDocument()
    const hero = doc.assets['a-hero']!
    const metas = {
      [`../assets/${hero.hash}.png`]: { src: 'hero', width: 1200, height: 800, format: 'png' },
    }
    calls.length = 0
    const images = await resolveAllImages(doc, metas, fakeGetImage)
    const img = images.get('a-hero')!
    expect(img.width).toBe(1200)
    expect(img.height).toBe(800)
    expect(img.src).toBe('/_astro/hero.webp')
    expect(img.srcset).toContain('/_astro/hero-1200.webp 1200w')
    expect(img.sources).toEqual([
      { type: 'image/avif', srcset: expect.stringContaining('.avif 320w') },
    ])
    expect(calls.map((c) => c.format)).toEqual(['avif', 'webp'])
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
