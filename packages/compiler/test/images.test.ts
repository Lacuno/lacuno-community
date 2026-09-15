import type { AssetRef } from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import { plainImageResolver } from '../src/images.js'

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
