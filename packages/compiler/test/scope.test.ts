import { fixtureDocument } from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import { RenderError } from '../src/errors.js'
import { resolveBinding, type Scope } from '../src/scope.js'

const doc = fixtureDocument()
const empty: Scope = { frames: [] }
const withEntry: Scope = {
  entry: doc.entries['col-posts']![0]!,
  collection: doc.collections['col-posts']!,
  frames: [],
}

describe('resolveBinding', () => {
  it('resolves static, design token and asset bindings', () => {
    expect(resolveBinding(doc, { type: 'static', value: 'x' }, empty, 'n')).toBe('x')
    expect(resolveBinding(doc, { type: 'static', value: 3 }, empty, 'n')).toBe(3)
    expect(resolveBinding(doc, { type: 'designToken', designToken: 't-brand' }, empty, 'n')).toBe(
      'var(--color-brand)',
    )
    expect(resolveBinding(doc, { type: 'asset', asset: 'a-hero' }, empty, 'n')).toBe(
      doc.assets['a-hero'],
    )
  })

  it('resolves fields from the current entry', () => {
    expect(resolveBinding(doc, { type: 'field', field: 'f-title' }, withEntry, 'n')).toBe(
      'Hello world',
    )
    expect(() => resolveBinding(doc, { type: 'field', field: 'f-title' }, empty, 'n')).toThrow(
      RenderError,
    )
    expect(() => resolveBinding(doc, { type: 'field', field: 'f-nope' }, withEntry, 'n')).toThrow(
      'unknown field f-nope',
    )
  })

  it('resolves props from the innermost frame with defaults', () => {
    const component = {
      ...doc.components['cmp-card']!,
      props: [
        { name: 'title', type: 'string' as const },
        { name: 'tone', type: 'string' as const, default: 'calm' },
      ],
    }
    const scope: Scope = {
      frames: [{ component, values: { title: 'T' }, slots: new Map(), outer: empty }],
    }
    expect(resolveBinding(doc, { type: 'prop', prop: 'title' }, scope, 'n')).toBe('T')
    expect(resolveBinding(doc, { type: 'prop', prop: 'tone' }, scope, 'n')).toBe('calm')
    expect(() => resolveBinding(doc, { type: 'prop', prop: 'nope' }, scope, 'n')).toThrow(
      'unknown prop nope',
    )
    expect(() => resolveBinding(doc, { type: 'prop', prop: 'title' }, empty, 'n')).toThrow(
      'prop binding outside a component',
    )
  })

  it('rejects unknown design tokens and assets with the node id', () => {
    try {
      resolveBinding(doc, { type: 'designToken', designToken: 't-nope' }, empty, 'n-x')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(RenderError)
      expect((e as RenderError).node).toBe('n-x')
    }
    expect(() => resolveBinding(doc, { type: 'asset', asset: 'a-nope' }, empty, 'n')).toThrow(
      'unknown asset a-nope',
    )
  })
})
