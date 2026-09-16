import { color, designToken, fixtureDocument, px, styleKey } from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import { planBatch } from '../src/engine.js'
import { OperationError } from '../src/errors.js'
import { OPERATIONS_BY_TYPE, type Operation } from '../src/operations/index.js'

const run = (ops: Operation[], doc = fixtureDocument()) => planBatch(doc, ops, OPERATIONS_BY_TYPE)
const failing = (ops: Operation[], pattern: RegExp, doc = fixtureDocument()) => {
  try {
    planBatch(doc, ops, OPERATIONS_BY_TYPE)
    expect.unreachable()
  } catch (e) {
    expect(e).toBeInstanceOf(OperationError)
    expect((e as OperationError).message).toMatch(pattern)
    return e as OperationError
  }
}

describe('classes', () => {
  it('creates, updates and deletes classes, deleting their own styles', () => {
    const { document } = run([
      { type: 'class.create', id: 'c-x', name: 'x', combo: ['c-button'] },
      {
        type: 'style.set',
        class: 'c-x',
        breakpoint: 'base',
        state: 'none',
        property: 'color',
        value: color('red'),
      },
      { type: 'class.update', id: 'c-x', name: 'y', combo: null, locked: true },
      { type: 'class.create', id: 'l-x', local: true },
    ])
    expect(document.classes['c-x']).toEqual({ id: 'c-x', kind: 'class', name: 'y', locked: true })
    expect(document.classes['l-x']).toEqual({ id: 'l-x', kind: 'local' })
    expect(Object.keys(document.styles).some((k) => k.startsWith('c-x|'))).toBe(true)
    const after = run([{ type: 'class.delete', id: 'c-x' }], document).document
    expect(after.classes['c-x']).toBeUndefined()
    expect(Object.keys(after.styles).some((k) => k.startsWith('c-x|'))).toBe(false)
  })
  it('refuses duplicate names, unknown or self combo parents, and deleting classes in use', () => {
    failing(
      [{ type: 'class.create', name: 'button' }],
      /class name button is already used by c-button/,
    )
    failing([{ type: 'class.create' }], /a named class needs a name/)
    failing([{ type: 'class.create', name: 'n', combo: ['c-nope'] }], /unknown class c-nope/)
    failing([{ type: 'class.update', id: 'c-button', combo: ['c-button'] }], /own combo parent/)
    const e = failing([{ type: 'class.delete', id: 'c-button' }], /referenced/)
    expect(e.referencedBy).toEqual(['classes.c-button-primary', 'nodes.n-hero-cta'])
  })
})

describe('styles', () => {
  it('sets and clears declarations by their derived key', () => {
    const coords = {
      class: 'c-hero',
      breakpoint: 'tablet',
      state: 'hover' as const,
      property: 'gap',
    }
    const { document, patches } = run([
      { type: 'style.set', ...coords, value: designToken('t-space-sm'), important: true },
    ])
    const key = styleKey(coords)
    expect(document.styles[key]).toEqual({
      ...coords,
      value: designToken('t-space-sm'),
      important: true,
    })
    expect(patches).toEqual([{ op: 'set', path: ['styles', key], value: document.styles[key] }])
    const cleared = run([{ type: 'style.clear', ...coords }], document).document
    expect(cleared.styles[key]).toBeUndefined()
  })
  it('validates coordinates and value references', () => {
    const base = { class: 'c-hero', breakpoint: 'base', state: 'none' as const, property: 'gap' }
    failing([{ type: 'style.set', ...base, class: 'c-nope', value: px(1) }], /unknown class c-nope/)
    failing(
      [{ type: 'style.set', ...base, breakpoint: 'nope', value: px(1) }],
      /unknown breakpoint nope/,
    )
    failing(
      [{ type: 'style.set', ...base, value: designToken('t-nope') }],
      /unknown design token t-nope/,
    )
    failing(
      [{ type: 'style.set', ...base, value: { type: 'image', asset: 'a-nope' } }],
      /unknown asset a-nope/,
    )
    failing(
      [{ type: 'style.set', ...base, property: 'Gap', value: px(1) }],
      /invalid input: property/,
    )
    failing([{ type: 'style.clear', ...base, property: 'nothing-set' }], /no declaration/)
  })
})

describe('breakpoints', () => {
  it('creates, updates and deletes breakpoints', () => {
    const { document } = run([
      { type: 'breakpoint.create', id: 'wide', label: 'Wide', minWidth: 1440 },
      { type: 'breakpoint.update', id: 'wide', label: 'Very wide', minWidth: 1600 },
      { type: 'breakpoint.update', id: 'mobile-p', maxWidth: null, minWidth: 100 },
      { type: 'breakpoint.delete', id: 'mobile-l' },
    ])
    expect(document.breakpoints.wide).toEqual({ id: 'wide', label: 'Very wide', minWidth: 1600 })
    expect(document.breakpoints['mobile-p']).toEqual({
      id: 'mobile-p',
      label: 'Mobile portrait',
      minWidth: 100,
    })
    expect(document.breakpoints['mobile-l']).toBeUndefined()
  })
  it('protects base and breakpoints in use', () => {
    failing([{ type: 'breakpoint.create', id: 'base', label: 'x' }], /already in use/)
    failing(
      [{ type: 'breakpoint.update', id: 'base', maxWidth: 100 }],
      /base breakpoint has no width/,
    )
    failing([{ type: 'breakpoint.delete', id: 'base' }], /cannot delete the base breakpoint/)
    const e = failing([{ type: 'breakpoint.delete', id: 'tablet' }], /referenced/)
    expect(e.referencedBy).toEqual(['styles.c-hero|tablet|none|grid-template-columns'])
  })
})
