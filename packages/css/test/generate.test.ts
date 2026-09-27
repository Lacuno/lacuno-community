import {
  color,
  createEmptyDocument,
  designToken,
  fixtureDocument,
  fn,
  kw,
  list,
  px,
  rem,
  styleKey,
} from '@lacuno/schema'
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
  designTokenName: (id: string) => ({ 't-brand': 'color.brand' })[id],
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
  it('formats design tokens, images, lists and functions', () => {
    expect(serializeValue(designToken('t-brand'), ctx)).toBe('var(--color-brand)')
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
  it('formats linear and radial gradients with tokens and positions', () => {
    const stops = [
      { color: { type: 'color' as const, value: '#fff' }, position: 0 },
      { color: { type: 'designToken' as const, ref: 't-brand' }, position: 62.5 },
    ]
    expect(serializeValue({ type: 'gradient', kind: 'linear', angle: 135, stops }, ctx)).toBe(
      'linear-gradient(135deg, #fff 0%, var(--color-brand) 62.5%)',
    )
    expect(serializeValue({ type: 'gradient', kind: 'linear', stops }, ctx)).toBe(
      'linear-gradient(180deg, #fff 0%, var(--color-brand) 62.5%)',
    )
    expect(serializeValue({ type: 'gradient', kind: 'radial', stops }, ctx)).toBe(
      'radial-gradient(#fff 0%, var(--color-brand) 62.5%)',
    )
  })
  it('throws on unknown references', () => {
    expect(() => serializeValue(designToken('nope'), ctx)).toThrow('unknown design token nope')
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
    expect(names.get('z')).toBe('lc-z')
    expect(classAttr(names, ['b', 'z', 'missing'])).toBe('card-2 lc-z')
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
    b.designTokens = Object.fromEntries(Object.entries(b.designTokens).reverse())
    expect(generateStylesheet(a).css).toBe(generateStylesheet(b).css)
  })

  it('emits design tokens for the default mode on :root and overrides per mode', () => {
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

  it('orders state rules so interaction beats visited and structural states', () => {
    const doc = createEmptyDocument()
    doc.classes.x = { id: 'x', kind: 'class', name: 'x' }
    for (const state of ['hover', 'odd', 'visited', 'even'] as const) {
      const d = {
        class: 'x',
        breakpoint: 'base',
        state,
        property: 'color',
        value: color('#000'),
      }
      doc.styles[styleKey(d)] = d
    }
    const { css } = generateStylesheet(doc, { reset: false })
    const hover = css.indexOf('.x:hover {')
    expect(hover).toBeGreaterThan(css.indexOf('.x:visited {'))
    expect(hover).toBeGreaterThan(css.indexOf('.x:nth-child(odd) {'))
    expect(hover).toBeGreaterThan(css.indexOf('.x:nth-child(even) {'))
  })

  it('emits the motion rules for a Motion field or an interactive state, never over an authored transition', () => {
    const doc = createEmptyDocument()
    doc.classes.x = { id: 'x', kind: 'class', name: 'x' }
    const add = (state: 'odd' | 'hover', property: string) => {
      const d = { class: 'x', breakpoint: 'base', state, property, value: color('#000') }
      doc.styles[styleKey(d)] = d
    }
    add('odd', 'color')
    expect(generateStylesheet(doc).css).not.toContain('data-lacuno-motion')
    add('hover', 'color')
    const { css } = generateStylesheet(doc)
    expect(css).toContain(':where([data-lacuno-motion]) {')
    expect(css).toContain(':where([data-lacuno-motion][data-lc-enter]) {')
    expect(css).toContain('[data-lacuno-motion] { animation: none !important')
  })

  it('drives states through the forced attribute when previewing states', () => {
    const doc = fixtureDocument()
    const forced = generateStylesheet(doc, { reset: false, previewStates: true }).css
    // Interaction states emit only the attribute form, so the live pointer cannot trigger them.
    expect(forced).toContain('.button[data-lc-state="hover"] {')
    expect(forced).not.toContain('.button:hover')
    // Pseudo-elements keep only their real form: forcing one would style the element itself.
    expect(forced).toContain('.card::before {')
    expect(forced).not.toContain('[data-lc-state="before"]')
    expect(forced).toContain('.button {\n')
    expect(generateStylesheet(doc, { reset: false }).css).toContain('.button:hover {')
    expect(generateStylesheet(doc, { reset: false }).css).not.toContain('data-lc-state')
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

it('gives direct formatting priority over shared combo and state rules', () => {
  const doc = fixtureDocument()
  const local = Object.values(doc.classes).find((cls) => cls.kind === 'local')!
  const names = classNames(doc)
  const localSpecificity = selectorFor(doc, names, local.id, 'none').split('.').length - 1
  for (const cls of Object.values(doc.classes).filter((cls) => cls.kind !== 'local')) {
    expect(localSpecificity).toBeGreaterThan((cls.combo?.length ?? 0) + 2)
  }
  expect(selectorFor(doc, names, local.id, 'hover')).toMatch(/:hover$/)
})

it('places presets above shared styles and below local formatting', () => {
  const doc = fixtureDocument()
  doc.classes['c-preset'] = { id: 'c-preset', name: 'Heading preset', kind: 'class', preset: true }
  const names = classNames(doc)
  const specificity = (id: string) => selectorFor(doc, names, id, 'none').split('.').length
  const local = Object.values(doc.classes).find((cls) => cls.kind === 'local')!
  expect(specificity(local.id)).toBeGreaterThan(specificity('c-preset') + 1)
  for (const cls of Object.values(doc.classes).filter((cls) => cls.kind === 'class' && !cls.preset))
    expect(specificity('c-preset')).toBeGreaterThan(specificity(cls.id) + 1)
})

it('emits rotating-words rules only for the word counts a document uses', () => {
  const doc = fixtureDocument()
  expect(generateStylesheet(doc).css).not.toContain('data-lc-words')
  const title = doc.nodes['n-hero-title']!
  if (title.type !== 'text') throw new Error('text expected')
  title.rotatingWords = { words: ['designer', 'you'] }
  const { css } = generateStylesheet(doc)
  expect(css).toContain('[data-lc-words] { --lc-interval: 2200ms;')
  expect(css).toContain('@keyframes lc-words-3 { 0%, 28.3333% { width: var(--lc-w0); }')
  expect(css).toContain(
    '[data-lc-words="3"] > :nth-child(2) { animation-delay: calc(var(--lc-interval) * -2); }',
  )
  expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  expect(css).not.toContain('lc-words-2')
})
