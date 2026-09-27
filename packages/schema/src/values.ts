import { z } from 'zod'
import { AssetId, DesignTokenId } from './ids.js'

/**
 * A typed CSS value. The style panel, the agent and the CSS generator all agree on this shape,
 * so a value can be edited structurally (drag a length, pick a design token) and still serialize to
 * exactly one CSS string.
 */
export const Unit = z.enum([
  'px',
  'rem',
  'em',
  '%',
  'vw',
  'vh',
  'vmin',
  'vmax',
  'dvh',
  'svh',
  'lvh',
  'ch',
  'ex',
  'fr',
  'deg',
  'turn',
  'ms',
  's',
  'number',
])
export type Unit = z.infer<typeof Unit>

export const UnitValue = z.object({
  type: z.literal('unit'),
  value: z.number().finite(),
  unit: Unit,
})

export const KeywordValue = z.object({ type: z.literal('keyword'), value: z.string().min(1) })

/** Any CSS color notation. Normalization happens in the editor, not the schema. */
export const ColorValue = z.object({ type: z.literal('color'), value: z.string().min(1) })

/** Reference to a design token. Compiles to var(--design-token-name). */
export const DesignTokenRef = z.object({ type: z.literal('designToken'), ref: DesignTokenId })

/** url() pointing at an asset in the library. */
export const ImageValue = z.object({ type: z.literal('image'), asset: AssetId })

/** Escape hatch. Emitted verbatim. The linter flags these so they stay rare. */
export const RawValue = z.object({ type: z.literal('raw'), value: z.string() })

/** A colour at a position along a gradient, in percent. */
export const GradientStop = z.strictObject({
  color: z.discriminatedUnion('type', [ColorValue, DesignTokenRef]),
  position: z.number().min(0).max(100),
})
export type GradientStop = z.infer<typeof GradientStop>

/**
 * A linear or radial gradient, for `background-image`. Structured rather than raw CSS so stops
 * can use design tokens and the editor can edit it. `angle` is the linear direction in degrees
 * (180, top to bottom, when left out).
 */
export const GradientValue = z
  .object({
    type: z.literal('gradient'),
    kind: z.enum(['linear', 'radial']),
    angle: z.number().finite().optional(),
    stops: z.array(GradientStop).min(2),
  })
  .refine((value) => value.kind === 'linear' || value.angle === undefined, {
    message: 'angle applies to linear gradients only',
    path: ['angle'],
  })
export type GradientValue = z.infer<typeof GradientValue>

export const ScalarValue = z.discriminatedUnion('type', [
  UnitValue,
  KeywordValue,
  ColorValue,
  DesignTokenRef,
  ImageValue,
  GradientValue,
  RawValue,
])
export type ScalarValue = z.infer<typeof ScalarValue>

/**
 * Space, comma or slash separated lists, e.g. `margin: 0 auto`, `font-family: a, b`,
 * `grid-area: 1 / 2`. Items may be scalars, nested lists (each shadow in `box-shadow: a, b`)
 * or functions.
 */
export const ListValue = z.object({
  type: z.literal('list'),
  separator: z.enum([' ', ', ', ' / ']),
  get values() {
    return z.array(CssValue).min(1)
  },
})
export type ListValue = z.infer<typeof ListValue>

/** Function call such as clamp(), calc(), minmax(), repeat(). Arguments are values. */
export const FunctionValue = z.object({
  type: z.literal('fn'),
  name: z.string().regex(/^[a-z-]+$/),
  get args() {
    return z.array(CssValue)
  },
})
export type FunctionValue = z.infer<typeof FunctionValue>

export const CssValue = z.union([ScalarValue, ListValue, FunctionValue])
export type CssValue = z.infer<typeof CssValue>

export const px = (value: number): CssValue => ({ type: 'unit', value, unit: 'px' })
export const rem = (value: number): CssValue => ({ type: 'unit', value, unit: 'rem' })
export const num = (value: number): CssValue => ({ type: 'unit', value, unit: 'number' })
export const kw = (value: string): CssValue => ({ type: 'keyword', value })
export const color = (value: string): CssValue => ({ type: 'color', value })
export const designToken = (ref: DesignTokenId): CssValue => ({ type: 'designToken', ref })
export const raw = (value: string): CssValue => ({ type: 'raw', value })
export const list = (values: CssValue[], separator: ' ' | ', ' | ' / ' = ' '): CssValue => ({
  type: 'list',
  separator,
  values,
})
export const fn = (name: string, args: CssValue[]): CssValue => ({ type: 'fn', name, args })
