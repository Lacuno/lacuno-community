import { fixtureDocument, list, type StyleDecl, styleKey } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { assetType, assetUses, fileSize, listAssets } from '../src/assets.js'

it('finds every kind of use of an asset, in words, with the element to show', () => {
  const doc = fixtureDocument()
  const hero = { type: 'image' as const, asset: 'a-hero' }
  const styles: StyleDecl[] = [
    {
      class: 'c-card',
      breakpoint: 'base',
      state: 'none',
      property: 'background-image',
      value: hero,
    },
    // Two breakpoints of one element read as one use.
    ...['base', 'tablet'].map(
      (breakpoint): StyleDecl => ({
        class: 'l-hero-title',
        breakpoint,
        state: 'none',
        property: 'background-image',
        value: list([hero], ', '),
      }),
    ),
    { class: 'c-spare', breakpoint: 'base', state: 'none', property: 'mask-image', value: hero },
  ]
  for (const decl of styles) doc.styles[styleKey(decl)] = decl
  doc.classes['c-spare'] = { id: 'c-spare', kind: 'class', name: 'spare' }
  doc.designTokens['t-hero'] = {
    id: 't-hero',
    name: 'image.hero',
    group: 'color',
    values: { light: hero },
  }
  doc.site.favicon = 'a-hero'
  doc.pages['p-home']!.seo = { ogImage: 'a-hero' }

  expect(assetUses(doc, 'a-hero')).toEqual([
    { label: 'image.hero', place: 'Design tokens' },
    { label: 'Image', place: 'Home', node: 'n-hero-image' },
    { label: 'Social image', place: 'Home' },
    { label: 'Favicon', place: 'Site settings' },
    { label: 'article · .card background-image', place: 'Card component', node: 'n-card' },
    { label: '.spare · mask-image', place: 'Unused class' },
    { label: 'Heading · background-image', place: 'Home', node: 'n-hero-title' },
  ])
  expect(assetUses(doc, 'a-sans')).toEqual([{ label: 'Fixture Sans Regular', place: 'Site fonts' }])
  expect(assetUses(doc, 'a-clip')).toEqual([
    expect.objectContaining({ label: 'Video', node: expect.any(String) }),
  ])
  delete doc.nodes['n-hero-image']!.attrs
  doc.site.favicon = undefined
  expect(assetUses(doc, 'a-hero').map((use) => use.label)).not.toContain('Favicon')
})

it('is empty for an unused asset', () => {
  const doc = fixtureDocument()
  doc.assets['a-spare'] = { ...doc.assets['a-hero']!, id: 'a-spare', name: 'spare.png' }
  expect(assetUses(doc, 'a-spare')).toEqual([])
})

it('lists assets newest first, by name or largest first, filtered by name', () => {
  const doc = fixtureDocument()
  doc.assets['a-hero']!.size = 300
  doc.assets['a-clip']!.size = 5000
  const names = (search: string, sort: 'newest' | 'name' | 'size') =>
    listAssets(doc, search, sort).map((asset) => asset.name)
  expect(names('', 'newest')).toEqual([
    'FixtureSans-Bold.woff2',
    'FixtureSans-Regular.woff2',
    'clip.mp4',
    'hero.png',
  ])
  expect(names('', 'name')).toEqual([
    'clip.mp4',
    'FixtureSans-Bold.woff2',
    'FixtureSans-Regular.woff2',
    'hero.png',
  ])
  expect(names('', 'size').slice(0, 2)).toEqual(['clip.mp4', 'hero.png'])
  expect(names(' SANS ', 'name')).toEqual(['FixtureSans-Bold.woff2', 'FixtureSans-Regular.woff2'])
})

it('names types and sizes the way people read them', () => {
  const doc = fixtureDocument()
  expect(assetType(doc.assets['a-hero']!)).toBe('PNG image')
  expect(assetType(doc.assets['a-clip']!)).toBe('MP4 video')
  expect(assetType(doc.assets['a-sans']!)).toBe('WOFF2 font')
  expect(assetType({ ...doc.assets['a-hero']!, kind: 'svg', mime: 'image/svg+xml' })).toBe('SVG')
  expect(assetType({ ...doc.assets['a-hero']!, kind: 'file', mime: 'application/pdf' })).toBe('PDF')
  expect([fileSize(410), fileSize(23_400), fileSize(2_400_000)]).toEqual([
    '410 B',
    '23 KB',
    '2.4 MB',
  ])
})
