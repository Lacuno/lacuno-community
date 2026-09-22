import { fixtureDocument, px, rem } from '@freeflow/schema'
import { expect, it } from 'vitest'
import {
  groupOfProperty,
  snapTo,
  tokenCssValue,
  tokenGroups,
  tokenLabel,
  tokenName,
  tokenPx,
  tokensOfGroup,
  tokenValue,
} from '../src/tokens.js'

it('maps exactly the listed style properties to token groups', () => {
  const mapped = [
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
    'gap',
    'width',
    'height',
    'min-width',
    'max-width',
    'font-family',
    'font-size',
    'line-height',
    'border-radius',
    'box-shadow',
  ]
  expect(mapped.map(groupOfProperty)).toEqual([
    ...Array(9).fill('spacing'),
    ...Array(4).fill('size'),
    ...Array(3).fill('typography'),
    'radius',
    'shadow',
  ])
  for (const property of ['padding', 'margin', 'color', 'border-width', 'opacity', 'toString'])
    expect(groupOfProperty(property)).toBeUndefined()
})

it('names tokens by group, rejecting invalid and duplicate names', () => {
  const doc = fixtureDocument()
  expect(tokenName(doc, 'spacing', 'Card Gap')).toBe('space.card-gap')
  expect(tokenName(doc, 'typography', 'heading.lg')).toBe('font.heading.lg')
  expect(tokenName(doc, 'shadow', 'soft')).toBe('shadow.soft')
  expect(() => tokenName(doc, 'size', 'bad;name')).toThrow('name')
  expect(() => tokenName(doc, 'spacing', 'MD')).toThrow('already exists')
  expect(tokenName(doc, 'spacing', 'md', 't-space-md')).toBe('space.md')
  expect(tokenLabel('space.card-gap')).toBe('card-gap')
  expect(tokenLabel('font.heading.lg')).toBe('heading.lg')
  expect(tokensOfGroup(doc, 'spacing').map((token) => token.name)).toEqual([
    'space.lg',
    'space.md',
    'space.sm',
  ])
  expect(tokenValue(doc, doc.designTokens['t-radius']!)).toEqual(px(8))
})

it('validates token values by group', () => {
  const { spacing, size, typography, radius, shadow } = tokenGroups
  for (const value of ['24px', '1.5rem', '.5em', '50%', '10vw', '100vh', '0'])
    for (const group of [spacing, size, radius]) expect(group.validate(value)).toBeUndefined()
  for (const value of ['24', 'auto', '1.5 rem', 'calc(1px + 2px)', '-4px', '', '12pt'])
    expect(spacing.validate(value)).toBeDefined()
  for (const value of ['Inter, sans-serif', '"Helvetica Neue", Arial', '1.25rem', '18px'])
    expect(typography.validate(value)).toBeUndefined()
  for (const value of ['Arial;position:fixed', 'url(x)', ''])
    expect(typography.validate(value)).toBeDefined()
  expect(shadow.validate('0 2px 8px #0003')).toBeUndefined()
  expect(shadow.validate('  ')).toBeDefined()
  expect(tokenCssValue(' 1.5rem ')).toEqual(rem(1.5))
  expect(tokenCssValue('0')).toEqual(px(0))
  expect(tokenCssValue('Inter, sans-serif')).toEqual({ type: 'raw', value: 'Inter, sans-serif' })
})

it('resolves token pixels and snaps to the nearest token within 4px', () => {
  expect(tokenPx(px(24), 10)).toBe(24)
  expect(tokenPx(rem(1.5), 10, 20)).toBe(30)
  expect(tokenPx({ type: 'unit', value: 2, unit: 'em' }, 10)).toBe(20)
  expect(tokenPx({ type: 'unit', value: 50, unit: '%' }, 10)).toBeUndefined()
  expect(tokenPx({ type: 'designToken', ref: 't-space-md' }, 10)).toBeUndefined()
  const snaps = [
    { ref: 'a', name: 'space.sm', px: 16 },
    { ref: 'b', name: 'space.md', px: 24 },
  ]
  expect(snapTo(19, snaps)?.name).toBe('space.sm')
  expect(snapTo(21, snaps)?.name).toBe('space.md')
  expect(snapTo(28, snaps)?.name).toBe('space.md')
  expect(snapTo(29, snaps)).toBeUndefined()
  expect(snapTo(20, [])).toBeUndefined()
})
