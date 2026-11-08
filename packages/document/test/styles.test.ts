import { color, designToken, fixtureDocument, num, px, raw, styleKey } from '@lacuno/schema'
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
  it("sets and clears a style that follows a parent's state, which a deleted parent class takes along", () => {
    const coords = {
      class: 'c-heading',
      breakpoint: 'base',
      state: 'open' as const,
      of: 'c-hero',
      property: 'rotate',
    }
    const set = {
      type: 'style.set' as const,
      ...coords,
      value: { type: 'raw' as const, value: '45deg' },
    }
    const { document } = run([set])
    expect(document.styles['c-heading|base|open@c-hero|rotate']).toEqual({
      ...coords,
      value: { type: 'raw', value: '45deg' },
    })
    expect(run([{ type: 'style.clear', ...coords }], document).document.styles).not.toHaveProperty(
      'c-heading|base|open@c-hero|rotate',
    )
    failing([{ ...set, of: 'c-nope' }], /unknown class c-nope/)
    failing(
      [{ ...set, state: 'first-child' }],
      /of follows a parent's hover, focus-within, open, target/,
    )
    failing([{ ...set, tag: 'a' }], /of cannot go with tag/)
    const parent = run([
      { type: 'class.create', id: 'c-item', name: 'item' },
      { ...set, of: 'c-item' },
      { type: 'class.delete', id: 'c-item' },
    ]).document
    expect(Object.keys(parent.styles).some((key) => key.includes('@c-item'))).toBe(false)
  })

  it('sets and clears a rich-text tag inside a class, and refuses tags off the list', () => {
    const coords = {
      class: 'c-hero',
      tag: 'h2' as const,
      breakpoint: 'base',
      state: 'none' as const,
    }
    const { document } = run([
      { type: 'style.set', ...coords, property: 'font-size', value: px(20) },
      {
        type: 'style.set',
        ...coords,
        tag: 'a',
        state: 'hover',
        property: 'color',
        value: color('red'),
      },
    ])
    expect(document.styles['c-hero|h2|base|none|font-size']).toEqual({
      ...coords,
      property: 'font-size',
      value: px(20),
    })
    expect(document.styles['c-hero|a|base|hover|color']?.tag).toBe('a')
    const cleared = run(
      [{ type: 'style.clear', ...coords, property: 'font-size' }],
      document,
    ).document
    expect(cleared.styles['c-hero|h2|base|none|font-size']).toBeUndefined()
    expect(() =>
      run([
        {
          type: 'style.set',
          ...coords,
          tag: 'div' as never,
          property: 'color',
          value: color('red'),
        },
      ]),
    ).toThrow()
    // Deleting the class takes its tag rules with it.
    const deleted = run([
      { type: 'class.create', id: 'c-rich', name: 'rich' },
      { type: 'style.set', ...coords, class: 'c-rich', property: 'margin-top', value: px(0) },
      { type: 'class.delete', id: 'c-rich' },
    ]).document
    expect(Object.keys(deleted.styles).some((key) => key.startsWith('c-rich|'))).toBe(false)
  })
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
    // A value that fails names what is wrong in the shape it came closest to, the allowed units.
    const unit = { type: 'unit', value: 1, unit: 'qq' } as never
    failing([{ type: 'style.set', ...base, value: unit }], /invalid input: value\.unit: .*"cqi"/)
    failing(
      [{ type: 'style.set', ...base, value: { type: 'list', separator: ' ', values: [unit] } }],
      /invalid input: value\.values\.0\.unit: .*"px"/,
    )
  })
  it('takes --lc-length as a number of screens and refuses a unit, which collapses the story', () => {
    const base = {
      class: 'c-hero',
      breakpoint: 'base',
      state: 'none' as const,
      property: '--lc-length',
    }
    run([
      { type: 'style.set', ...base, value: raw('2.5') },
      { type: 'style.set', ...base, value: num(4) },
    ])
    failing(
      [{ type: 'style.set', ...base, value: raw('280svh') }],
      /--lc-length is a number of screens/,
    )
    failing([{ type: 'style.set', ...base, value: px(3) }], /without a unit/)
  })
  it('checks the design tokens a gradient stop uses and keeps them from deletion', () => {
    const gradient = (ref: string) => ({
      type: 'style.set' as const,
      class: 'c-hero',
      breakpoint: 'base',
      state: 'none' as const,
      property: 'background-image',
      value: {
        type: 'gradient' as const,
        kind: 'linear' as const,
        angle: 90,
        stops: [
          { color: { type: 'color' as const, value: '#fff' }, position: 0 },
          { color: { type: 'designToken' as const, ref }, position: 100 },
        ],
      },
    })
    failing([gradient('t-nope')], /unknown design token t-nope/)
    const { document } = run([gradient('t-brand')])
    const e = failing([{ type: 'designToken.delete', id: 't-brand' }], /referenced/, document)
    expect(e.referencedBy).toContain('styles.c-hero|base|none|background-image')
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
