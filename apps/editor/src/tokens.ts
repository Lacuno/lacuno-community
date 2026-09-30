import type { CssValue, DesignToken, Document } from '@lacuno/schema'
import { designTokenCssName, safeTextStyleValue } from '@lacuno/schema'
import { defaultMode } from './colors.js'
import { isNumber } from './formatting.js'

const lengthPattern = /^(\d*\.?\d+)(px|rem|em|%|vw|vh)$/
const length = (value: string) =>
  lengthPattern.test(value.trim()) || value.trim() === '0'
    ? undefined
    : 'Enter a length such as 24px, 1.5rem or 50%.'

/** The non-colour token groups the editor manages, each with its name prefix and value check. */
export const tokenGroups = {
  spacing: { prefix: 'space', label: 'Spacing', example: '24px', validate: length },
  size: { prefix: 'size', label: 'Size', example: '1200px', validate: length },
  typography: {
    prefix: 'font',
    label: 'Typography',
    example: 'Inter, sans-serif',
    validate: (value: string) =>
      !length(value) || safeTextStyleValue('fontFamily', value)
        ? undefined
        : 'Enter a font stack such as Inter, sans-serif, or a size such as 1.25rem.',
  },
  radius: { prefix: 'radius', label: 'Radius', example: '8px', validate: length },
  shadow: {
    prefix: 'shadow',
    label: 'Shadow',
    example: '0 2px 8px #0003',
    validate: (value: string) => (value.trim() ? undefined : 'Enter a shadow.'),
  },
} as const
export type TokenGroup = keyof typeof tokenGroups
/** A token the canvas handles can snap to, resolved to pixels. */
export type Snap = { ref: string; name: string; px: number }

const propertyGroups: Record<string, TokenGroup> = {
  'padding-top': 'spacing',
  'padding-right': 'spacing',
  'padding-bottom': 'spacing',
  'padding-left': 'spacing',
  'margin-top': 'spacing',
  'margin-right': 'spacing',
  'margin-bottom': 'spacing',
  'margin-left': 'spacing',
  gap: 'spacing',
  'column-gap': 'spacing',
  'row-gap': 'spacing',
  width: 'size',
  height: 'size',
  'min-width': 'size',
  'max-width': 'size',
  'font-family': 'typography',
  'font-size': 'typography',
  'line-height': 'typography',
  'border-radius': 'radius',
  'box-shadow': 'shadow',
}
export const groupOfProperty = (property: string): TokenGroup | undefined =>
  Object.hasOwn(propertyGroups, property) ? propertyGroups[property] : undefined

export const tokensOfGroup = (doc: Document, group: TokenGroup) =>
  Object.values(doc.designTokens)
    .filter((token) => token.group === group)
    .sort((a, b) => a.name.localeCompare(b.name))

const numeric = (value: CssValue | undefined) =>
  value?.type === 'unit' || (value?.type === 'raw' && isNumber(value.value))

/** The tokens a field may bind to: its group's, and for typography only those of the right kind. */
export const tokensForProperty = (doc: Document, property: string) => {
  const group = groupOfProperty(property)
  if (!group) return []
  const tokens = tokensOfGroup(doc, group)
  if (group !== 'typography') return tokens
  // A font stack belongs to font-family; a length or number to font-size and line-height.
  const wantNumeric = property !== 'font-family'
  return tokens.filter((token) => numeric(tokenValue(doc, token)) === wantNumeric)
}

/** The prefixed dot-path name for what the designer typed after the prefix. */
export function tokenName(doc: Document, group: TokenGroup, name: string, except?: string) {
  const slug = name.trim().toLowerCase().replace(/\s+/g, '-')
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(slug))
    throw new Error('Use a name with letters, numbers, dots, spaces or hyphens.')
  const result = `${tokenGroups[group].prefix}.${slug}`
  if (
    Object.values(doc.designTokens).some(
      (token) =>
        token.id !== except && designTokenCssName(token.name) === designTokenCssName(result),
    )
  )
    throw new Error('A token with this name already exists.')
  return result
}
export const tokenLabel = (name: string) => name.slice(name.indexOf('.') + 1)
export const tokenValue = (doc: Document, token: DesignToken) => token.values[defaultMode(doc)]!

/** What the designer typed as a typed value: a length becomes a unit value, anything else raw. */
export function tokenCssValue(text: string): CssValue {
  const match = text.trim().match(lengthPattern)
  if (match) return { type: 'unit', value: Number(match[1]), unit: match[2] as 'px' }
  return text.trim() === '0'
    ? { type: 'unit', value: 0, unit: 'px' }
    : { type: 'raw', value: text.trim() }
}

/** A token value in pixels for snapping: px, rem (against the root) and em (against the element). */
export function tokenPx(value: CssValue | undefined, fontSize: number, rootSize = 16) {
  if (value?.type !== 'unit') return undefined
  const scale: Partial<Record<string, number>> = { px: 1, rem: rootSize, em: fontSize }
  return scale[value.unit] === undefined ? undefined : value.value * scale[value.unit]!
}

/** The nearest snap within 4px of a dragged value, if any. */
export function snapTo(value: number, snaps: Snap[]) {
  const nearest = snaps.reduce<Snap | undefined>(
    (best, snap) => (!best || Math.abs(snap.px - value) < Math.abs(best.px - value) ? snap : best),
    undefined,
  )
  return nearest && Math.abs(nearest.px - value) <= 4 ? nearest : undefined
}
