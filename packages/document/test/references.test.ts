import { fixtureDocument } from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import { allIds } from '../src/ids.js'
import { partialPatches } from '../src/partial.js'
import {
  designTokensUsingMode,
  instancesOfComponent,
  isDescendant,
  isRootNode,
  nodesUsingClass,
  parentIndex,
  referencesToAsset,
  referencesToCollection,
  referencesToDesignToken,
  stylesUsingBreakpoint,
  subtreeIds,
} from '../src/references.js'

const doc = fixtureDocument()

describe('ids and tree helpers', () => {
  it('collects every id in use', () => {
    const ids = allIds(doc)
    for (const id of [
      'p-home',
      'n-hero',
      'c-button',
      'base',
      't-brand',
      'cmp-card',
      'col-posts',
      'a-hero',
      'light',
      'e-1',
      'f-title',
    ])
      expect(ids.has(id)).toBe(true)
    expect(ids.has('nope')).toBe(false)
  })
  it('walks subtrees, ancestry and roots', () => {
    expect(subtreeIds(doc, 'n-hero')).toEqual([
      'n-hero',
      'n-hero-inner',
      'n-hero-title',
      'n-hero-image',
      'n-hero-cta',
    ])
    expect(isDescendant(doc, 'n-home', 'n-hero-cta')).toBe(true)
    expect(isDescendant(doc, 'n-hero-cta', 'n-home')).toBe(false)
    expect(isDescendant(doc, 'n-hero', 'n-hero')).toBe(false)
    expect(isRootNode(doc, 'n-home')).toBe(true)
    expect(isRootNode(doc, 'n-card')).toBe(true)
    expect(isRootNode(doc, 'n-hero')).toBe(false)
    expect(parentIndex(doc, 'n-hero-cta')).toEqual({ parent: 'n-hero-inner', index: 2 })
    expect(parentIndex(doc, 'n-home')).toBeUndefined()
  })
})

describe('reference scanners', () => {
  it('finds class, breakpoint and component users', () => {
    expect(nodesUsingClass(doc, 'c-container')).toEqual(['n-hero', 'n-post', 'n-posts'])
    expect(stylesUsingBreakpoint(doc, 'tablet')).toEqual([
      'c-hero|tablet|none|grid-template-columns',
    ])
    expect(instancesOfComponent(doc, 'cmp-card')).toEqual(['n-post-card'])
  })
  it('finds design token references in styles, other tokens and bindings', () => {
    expect(referencesToDesignToken(doc, 't-brand')).toEqual([
      'styles.c-button-primary|base|none|background-color',
      'styles.c-button|base|focus-visible|outline',
    ])
    const withBinding = fixtureDocument()
    withBinding.nodes['n-hero-cta']!.attrs = {
      'data-x': { type: 'designToken', designToken: 't-radius' },
    }
    expect(referencesToDesignToken(withBinding, 't-radius')).toContain('nodes.n-hero-cta')
  })
  it('finds asset references in nodes, styles, fonts, favicon and seo', () => {
    const d = fixtureDocument()
    d.site.favicon = 'a-hero'
    d.pages['p-home']!.seo = { ogImage: 'a-hero' }
    d.site.fonts = [{ family: 'X', source: 'asset', asset: 'a-hero' }]
    expect(referencesToAsset(d, 'a-hero')).toEqual([
      'nodes.n-hero-image',
      'pages.p-home.seo.ogImage',
      'site.favicon',
      'site.fonts.0',
    ])
  })
  it('finds collection references in pages, lists and fields', () => {
    expect(referencesToCollection(doc, 'col-posts')).toEqual(['nodes.n-posts', 'pages.p-post'])
    expect(designTokensUsingMode(doc, 'dark')).toEqual([
      't-bg',
      't-border',
      't-brand-hover',
      't-fg',
      't-surface-muted',
    ])
  })
})

describe('partialPatches', () => {
  it('sets, deletes on null, skips undefined', () => {
    expect(
      partialPatches(['site'], { name: 'N', url: null, locale: undefined }, { url: 'x' }),
    ).toEqual([
      { op: 'set', path: ['site', 'name'], value: 'N' },
      { op: 'delete', path: ['site', 'url'] },
    ])
    expect(partialPatches(['site'], { url: null }, { name: 'only' })).toEqual([])
  })
})
