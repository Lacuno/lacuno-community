import { describe, expect, it } from 'vitest'
import {
  checkReferences,
  createEmptyDocument,
  DocumentError,
  fixtureDocument,
  newId,
  parseDocument,
  parseStyleKey,
  styleKey,
  tokenCssName,
} from '../src/index.js'

describe('document schema', () => {
  it('accepts an empty document', () => {
    const doc = createEmptyDocument('Test')
    expect(parseDocument(doc)).toEqual(doc)
  })

  it('accepts the fixture and round-trips through JSON', () => {
    const doc = fixtureDocument()
    expect(checkReferences(doc)).toEqual([])
    const again = parseDocument(JSON.parse(JSON.stringify(doc)))
    expect(again).toEqual(doc)
  })

  it('rejects a broken parent link', () => {
    const doc = fixtureDocument()
    doc.nodes['n-hero']!.parent = 'nope'
    expect(() => parseDocument(doc)).toThrow(DocumentError)
    expect(checkReferences(doc).map((i) => i.message)).toContain('unknown parent nope')
  })

  it('rejects a child whose parent does not list it', () => {
    const doc = fixtureDocument()
    doc.nodes['n-home']!.children = ['n-hero']
    const msgs = checkReferences(doc).map((i) => i.message)
    expect(msgs.some((m) => m.includes('does not list it as a child'))).toBe(true)
  })

  it('rejects unknown classes, tokens modes and combo parents', () => {
    const doc = fixtureDocument()
    doc.nodes['n-hero']!.classes.push('c-missing')
    doc.tokens['t-fg']!.values.sepia = { type: 'color', value: '#000' }
    doc.classes['c-button-primary']!.combo = ['c-gone']
    const msgs = checkReferences(doc).map((i) => i.message)
    expect(msgs).toContain('unknown class c-missing')
    expect(msgs).toContain('unknown mode sepia')
    expect(msgs).toContain('unknown combo parent c-gone')
  })

  it('rejects a style whose key does not match its coordinates', () => {
    const doc = fixtureDocument()
    const [key, decl] = Object.entries(doc.styles)[0]!
    doc.styles[`${key}x`] = decl
    const msgs = checkReferences(doc).map((i) => i.message)
    expect(msgs.some((m) => m.startsWith('key does not match'))).toBe(true)
  })

  it('rejects duplicate page paths and collection pages without a param', () => {
    const doc = fixtureDocument()
    doc.pages['p-post']!.path = '/'
    const msgs = checkReferences(doc).map((i) => i.message)
    expect(msgs.some((m) => m.includes('already used'))).toBe(true)
    expect(msgs).toContain('collection page path needs a [param]')
  })

  it('requires exactly one default mode', () => {
    const doc = fixtureDocument()
    doc.site.modes[1]!.default = true
    expect(checkReferences(doc).map((i) => i.message)).toContain(
      'expected exactly one default mode, found 2',
    )
  })

  it('rejects wrong shapes with paths', () => {
    const doc = fixtureDocument() as unknown as Record<string, unknown>
    doc.version = 99
    try {
      parseDocument(doc)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(DocumentError)
      expect((e as DocumentError).issues[0]!.path).toBe('version')
    }
  })
})

describe('helpers', () => {
  it('style keys round-trip', () => {
    const k = styleKey({ class: 'a', breakpoint: 'base', state: 'hover', property: 'color' })
    expect(k).toBe('a|base|hover|color')
    expect(parseStyleKey(k)).toEqual({
      class: 'a',
      breakpoint: 'base',
      state: 'hover',
      property: 'color',
    })
    expect(() => parseStyleKey('a|b')).toThrow()
  })

  it('token css names are custom properties', () => {
    expect(tokenCssName('color.brand.hover')).toBe('--color-brand-hover')
  })

  it('ids are unique and well formed', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{12}$/)
  })
})
