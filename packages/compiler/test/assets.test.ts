import type { AssetRef } from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import {
  assetFileName,
  extensionForMime,
  isOptimizedImage,
  publicAssetPath,
} from '../src/assets.js'

describe('extensionForMime', () => {
  it('maps known MIME types to extensions', () => {
    expect(extensionForMime('image/png')).toBe('png')
    expect(extensionForMime('image/jpeg')).toBe('jpg')
    expect(extensionForMime('image/svg+xml')).toBe('svg')
    expect(extensionForMime('font/woff2')).toBe('woff2')
  })

  it('returns bin for unknown MIME types', () => {
    expect(extensionForMime('application/unknown')).toBe('bin')
    expect(extensionForMime('text/plain')).toBe('bin')
  })
})

describe('assetFileName', () => {
  it('generates <hash>.<ext> from asset', () => {
    const asset: AssetRef = {
      id: 'a-1',
      name: 'test.png',
      hash: 'abc123',
      mime: 'image/png',
      kind: 'image',
      size: 1024,
    }
    expect(assetFileName(asset)).toBe('abc123.png')
  })

  it('handles svg+xml correctly', () => {
    const asset: AssetRef = {
      id: 'a-2',
      name: 'test.svg',
      hash: 'xyz789',
      mime: 'image/svg+xml',
      kind: 'image',
      size: 512,
    }
    expect(assetFileName(asset)).toBe('xyz789.svg')
  })
})

describe('publicAssetPath', () => {
  it('returns /assets/<hash>.<ext> URL', () => {
    const asset: AssetRef = {
      id: 'a-3',
      name: 'test.png',
      hash: 'abc123',
      mime: 'image/png',
      kind: 'image',
      size: 1024,
    }
    expect(publicAssetPath(asset)).toBe('/assets/abc123.png')
  })

  it('handles svg+xml correctly', () => {
    const asset: AssetRef = {
      id: 'a-4',
      name: 'test.svg',
      hash: 'xyz789',
      mime: 'image/svg+xml',
      kind: 'image',
      size: 512,
    }
    expect(publicAssetPath(asset)).toBe('/assets/xyz789.svg')
  })
})

describe('isOptimizedImage', () => {
  it('returns true for image assets', () => {
    const asset: AssetRef = {
      id: 'a-5',
      name: 'test.png',
      hash: 'abc123',
      mime: 'image/png',
      kind: 'image',
      size: 1024,
    }
    expect(isOptimizedImage(asset)).toBe(true)
  })

  it('returns false for non-image assets', () => {
    const svg: AssetRef = {
      id: 'a-6',
      name: 'test.svg',
      hash: 'xyz789',
      mime: 'image/svg+xml',
      kind: 'file',
      size: 512,
    }
    expect(isOptimizedImage(svg)).toBe(false)

    const file: AssetRef = {
      id: 'a-7',
      name: 'test.pdf',
      hash: 'def456',
      mime: 'application/pdf',
      kind: 'file',
      size: 2048,
    }
    expect(isOptimizedImage(file)).toBe(false)
  })
})
