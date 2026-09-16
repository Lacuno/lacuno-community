import { describe, expect, it } from 'vitest'
import {
  AssetHash,
  checkReferences,
  createEmptyDocument,
  DocumentError,
  designTokenCssName,
  fixtureDocument,
  hashAsset,
  newId,
  parseDocument,
  parseStyleKey,
  styleKey,
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

  it('rejects an id that shadows an Object.prototype property name', () => {
    const doc = fixtureDocument() as unknown as Record<string, unknown>
    const classes = doc.classes as Record<string, unknown>
    const template = classes['c-button']
    classes.constructor = template
    expect(() => parseDocument(doc)).toThrow(DocumentError)
  })

  it('rejects unknown classes, design token modes and combo parents', () => {
    const doc = fixtureDocument()
    doc.nodes['n-hero']!.classes.push('c-missing')
    doc.designTokens['t-fg']!.values.sepia = { type: 'color', value: '#000' }
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

  it('accepts entries and exposes them in the fixture', () => {
    const doc = fixtureDocument()
    expect(doc.entries['col-posts']).toHaveLength(3)
    expect(doc.entries['col-posts']![0]!.fields['f-slug']).toBe('hello-world')
    expect(checkReferences(doc)).toEqual([])
    expect(createEmptyDocument().entries).toEqual({})
  })

  it('rejects entries with unknown collections, missing required fields and duplicate slugs', () => {
    const doc = fixtureDocument()
    doc.entries['col-missing'] = [{ id: 'e-x', fields: {} }]
    doc.entries['col-posts']!.push({ id: 'e-4', fields: { 'f-slug': 'hello-world' } })
    const msgs = checkReferences(doc).map((i) => i.message)
    expect(msgs).toContain('unknown collection col-missing')
    expect(msgs).toContain('missing required field title')
    expect(msgs).toContain('duplicate slug hello-world')
  })

  it('requires asset hashes to be lower-case sha256 hex', () => {
    const doc = fixtureDocument()
    expect(doc.assets['a-hero']!.hash).toMatch(/^[a-f0-9]{64}$/)
    doc.assets['a-hero']!.hash = 'fixture-hero'
    expect(() => parseDocument(doc)).toThrow(DocumentError)
    doc.assets['a-hero']!.hash = 'A'.repeat(64)
    expect(() => parseDocument(doc)).toThrow(DocumentError)
  })

  it('hashes asset bytes to the same digest every producer must use', async () => {
    const bytes = new TextEncoder().encode('hello')
    expect(await hashAsset(bytes)).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
    expect(AssetHash.safeParse(await hashAsset(new Uint8Array())).success).toBe(true)
  })

  it('types option and reference fields by their discriminator', () => {
    const doc = fixtureDocument()
    const col = doc.collections['col-posts']!
    expect(col.fields.find((f) => f.id === 'f-status')).toEqual({
      id: 'f-status',
      name: 'status',
      label: 'Status',
      type: 'option',
      options: [{ value: 'draft', label: 'Draft' }, { value: 'published' }],
    })
    const raw = JSON.parse(JSON.stringify(doc)) as {
      collections: { 'col-posts': { fields: unknown[] } }
    }
    const fields = raw.collections['col-posts'].fields as Record<string, unknown>[]
    // An option field must list its choices.
    fields.push({ id: 'f-x', name: 'x', label: 'X', type: 'option' })
    expect(() => parseDocument(raw)).toThrow(DocumentError)
    // A text field must not carry choices or a reference.
    fields[fields.length - 1] = { id: 'f-x', name: 'x', label: 'X', type: 'text', options: [] }
    expect(() => parseDocument(raw)).toThrow(DocumentError)
    fields[fields.length - 1] = { id: 'f-x', name: 'x', label: 'X', type: 'reference' }
    expect(() => parseDocument(raw)).toThrow(DocumentError)
    fields.pop()
    expect(() => parseDocument(raw)).not.toThrow()
  })

  it('checks reference targets and option values', () => {
    const doc = fixtureDocument()
    doc.collections['col-posts']!.fields.push({
      id: 'f-rel',
      name: 'rel',
      label: 'Related',
      type: 'reference',
      reference: 'col-nope',
    })
    doc.entries['col-posts']![0]!.fields['f-status'] = 'archived'
    const msgs = checkReferences(doc).map((i) => i.message)
    expect(msgs).toContain('reference field rel points at unknown collection col-nope')
    expect(msgs).toContain('"archived" is not an option of field status')
  })

  it('accepts an optional site url and rejects a malformed one', () => {
    const doc = fixtureDocument()
    doc.site.url = 'https://example.com'
    expect(parseDocument(doc).site.url).toBe('https://example.com')
    doc.site.url = 'not a url'
    expect(() => parseDocument(doc)).toThrow(DocumentError)
  })

  it('carries a revision that defaults to zero and must be a non-negative integer', () => {
    expect(createEmptyDocument().revision).toBe(0)
    expect(fixtureDocument().revision).toBe(0)
    const raw = JSON.parse(JSON.stringify(fixtureDocument())) as Record<string, unknown>
    raw.revision = undefined
    expect(parseDocument(raw).revision).toBe(0)
    raw.revision = 7
    expect(parseDocument(raw).revision).toBe(7)
    raw.revision = -1
    expect(() => parseDocument(raw)).toThrow(DocumentError)
    raw.revision = 1.5
    expect(() => parseDocument(raw)).toThrow(DocumentError)
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

  it('design token css names are custom properties', () => {
    expect(designTokenCssName('color.brand.hover')).toBe('--color-brand-hover')
  })

  it('ids are unique and well formed', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{12}$/)
  })
})
