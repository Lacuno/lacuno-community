import {
  color,
  createEmptyDocument,
  fixtureDocument,
  fn,
  kw,
  list,
  px,
  rem,
  styleKey,
  token,
} from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import {
  classAttr,
  classNames,
  cssIdent,
  generateStylesheet,
  selectorFor,
  serializeValue,
} from '../src/index.js'

const ctx = {
  tokenName: (id: string) => ({ 't-brand': 'color.brand' })[id],
  assetUrl: (id: string) => ({ 'a-1': '/assets/a1.png' })[id],
}

describe('serializeValue', () => {
  it('formats units, numbers and zero', () => {
    expect(serializeValue(px(12), ctx)).toBe('12px')
    expect(serializeValue(rem(1.5), ctx)).toBe('1.5rem')
    expect(serializeValue(px(0), ctx)).toBe('0')
    expect(serializeValue({ type: 'unit', value: 0, unit: '%' }, ctx)).toBe('0%')
    expect(serializeValue({ type: 'unit', value: 1.1, unit: 'number' }, ctx)).toBe('1.1')
    expect(serializeValue({ type: 'unit', value: 0.33333333, unit: 'fr' }, ctx)).toBe('0.3333fr')
    expect(serializeValue({ type: 'unit', value: -0.0000001, unit: 'em' }, ctx)).toBe('0')
  })
  it('formats tokens, images, lists and functions', () => {
    expect(serializeValue(token('t-brand'), ctx)).toBe('var(--color-brand)')
    expect(serializeValue({ type: 'image', asset: 'a-1' }, ctx)).toBe('url("/assets/a1.png")')
    expect(serializeValue(list([px(0), kw('auto')]), ctx)).toBe('0 auto')
    expect(serializeValue(list([kw('Inter'), kw('sans-serif')], ', '), ctx)).toBe(
      'Inter, sans-serif',
    )
    expect(
      serializeValue(fn('clamp', [rem(1), { type: 'unit', value: 2, unit: 'vw' }, rem(2)]), ctx),
    ).toBe('clamp(1rem, 2vw, 2rem)')
    expect(
      serializeValue(
        fn('repeat', [
          kw('auto-fill'),
          fn('minmax', [px(200), { type: 'unit', value: 1, unit: 'fr' }]),
        ]),
        ctx,
      ),
    ).toBe('repeat(auto-fill, minmax(200px, 1fr))')
    expect(serializeValue(color('oklch(70% 0.1 200)'), ctx)).toBe('oklch(70% 0.1 200)')
  })
  it('throws on unknown references', () => {
    expect(() => serializeValue(token('nope'), ctx)).toThrow('unknown token nope')
    expect(() => serializeValue({ type: 'image', asset: 'nope' }, ctx)).toThrow(
      'unknown asset nope',
    )
  })
})

describe('class names and selectors', () => {
  it('sanitizes identifiers', () => {
    expect(cssIdent('Hero Section!')).toBe('hero-section')
    expect(cssIdent('  ')).toBe('class')
    expect(cssIdent('2col')).toBe('c-2col')
    expect(cssIdent('-x-')).toBe('x')
  })
  it('deduplicates names and generates local names', () => {
    const doc = createEmptyDocument()
    doc.classes = {
      b: { id: 'b', kind: 'class', name: 'Card' },
      a: { id: 'a', kind: 'class', name: 'card' },
      z: { id: 'z', kind: 'local' },
    }
    const names = classNames(doc)
    expect(names.get('a')).toBe('card')
    expect(names.get('b')).toBe('card-2')
    expect(names.get('z')).toBe('ff-z')
    expect(classAttr(names, ['b', 'z', 'missing'])).toBe('card-2 ff-z')
  })
  it('builds combo and state selectors', () => {
    const doc = fixtureDocument()
    const names = classNames(doc)
    expect(selectorFor(doc, names, 'c-button', 'none')).toBe('.button')
    expect(selectorFor(doc, names, 'c-button-primary', 'hover')).toBe('.button.primary:hover')
    expect(selectorFor(doc, names, 'c-card', 'before')).toBe('.card::before')
    expect(selectorFor(doc, names, 'c-card', 'odd')).toBe('.card:nth-child(odd)')
  })
})

describe('generateStylesheet', () => {
  it('matches the snapshot for the fixture', () => {
    const { css } = generateStylesheet(fixtureDocument())
    expect(css).toMatchSnapshot()
  })

  it('is deterministic regardless of insertion order', () => {
    const a = fixtureDocument()
    const b = fixtureDocument()
    b.styles = Object.fromEntries(Object.entries(b.styles).reverse())
    b.classes = Object.fromEntries(Object.entries(b.classes).reverse())
    b.tokens = Object.fromEntries(Object.entries(b.tokens).reverse())
    expect(generateStylesheet(a).css).toBe(generateStylesheet(b).css)
  })

  it('emits tokens for the default mode on :root and overrides per mode', () => {
    const { css } = generateStylesheet(fixtureDocument(), { reset: false })
    expect(css).toContain(':root {\n  --color-bg: #fff;')
    expect(css).toContain(
      '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme]) {\n    --color-bg: #111;',
    )
    expect(css).toContain('[data-theme="dark"] {\n  --color-bg: #111;')
    // brand has no dark value, so it must not appear in the dark block
    const dark = css.slice(css.indexOf('[data-theme="dark"]'))
    expect(dark).not.toContain('--color-brand:')
    expect(dark).toContain('--color-brand-hover:')
  })

  it('orders breakpoints desktop-first and puts combos after their parents', () => {
    const { css } = generateStylesheet(fixtureDocument(), { reset: false })
    const base = css.indexOf('.hero {')
    const tablet = css.indexOf('@media (max-width: 991px)')
    const mobile = css.indexOf('@media (max-width: 479px)')
    expect(base).toBeGreaterThan(0)
    expect(tablet).toBeGreaterThan(base)
    expect(mobile).toBeGreaterThan(tablet)
    expect(css.indexOf('.button {')).toBeLessThan(css.indexOf('.button.primary {'))
    expect(css.indexOf('.button {')).toBeLessThan(css.indexOf('.button:hover {'))
    expect(css.indexOf('.button:hover {')).toBeLessThan(css.indexOf('.button.primary {'))
  })

  it('emits nothing for an empty document beyond the reset', () => {
    const { css } = generateStylesheet(createEmptyDocument())
    expect(css.trim().endsWith('a { color: inherit; }')).toBe(true)
  })

  it('supports important and min-width breakpoints', () => {
    const doc = createEmptyDocument()
    doc.breakpoints.wide = { id: 'wide', label: 'Wide', minWidth: 1440 }
    doc.classes.x = { id: 'x', kind: 'class', name: 'x' }
    const d1 = {
      class: 'x',
      breakpoint: 'base',
      state: 'none' as const,
      property: 'color',
      value: color('red'),
      important: true,
    }
    const d2 = {
      class: 'x',
      breakpoint: 'wide',
      state: 'none' as const,
      property: 'color',
      value: color('blue'),
    }
    doc.styles = { [styleKey(d1)]: d1, [styleKey(d2)]: d2 }
    const { css } = generateStylesheet(doc, { reset: false })
    expect(css).toBe(
      '.x {\n  color: red !important;\n}\n\n@media (min-width: 1440px) {\n  .x {\n    color: blue;\n  }\n}\n',
    )
  })
})
