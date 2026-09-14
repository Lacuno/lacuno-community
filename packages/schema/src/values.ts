import { z } from 'zod'
import { AssetId, TokenId } from './ids.js'

/**
 * A typed CSS value. The style panel, the agent and the CSS generator all agree on this shape,
 * so a value can be edited structurally (drag a length, pick a token) and still serialize to
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

/** Reference to a design token. Compiles to var(--token-name). */
export const TokenRef = z.object({ type: z.literal('token'), ref: TokenId })

/** url() pointing at an asset in the library. */
export const ImageValue = z.object({ type: z.literal('image'), asset: AssetId })

/** Escape hatch. Emitted verbatim. The linter flags these so they stay rare. */
export const RawValue = z.object({ type: z.literal('raw'), value: z.string() })

export const ScalarValue = z.discriminatedUnion('type', [
  UnitValue,
  KeywordValue,
  ColorValue,
  TokenRef,
  ImageValue,
  RawValue,
])
export type ScalarValue = z.infer<typeof ScalarValue>

/**
 * Space, comma or slash separated lists, e.g. `margin: 0 auto`, `font-family: a, b`,
 * `grid-area: 1 / 2`. Items may be scalars, nested lists (each shadow in `box-shadow: a, b`)
 * or functions.
 */
export type ListValue = {
  type: 'list'
  separator: ' ' | ', ' | ' / '
  values: CssValue[]
}

/** Function call such as clamp(), calc(), minmax(), repeat(). Arguments are values. */
export type FunctionValue = {
  type: 'fn'
  name: string
  args: CssValue[]
}

export type CssValue = ScalarValue | ListValue | FunctionValue

export const ListValue: z.ZodType<ListValue> = z.object({
  type: z.literal('list'),
  separator: z.enum([' ', ', ', ' / ']),
  values: z.array(z.lazy(() => CssValue)).min(1),
})

export const FunctionValue: z.ZodType<FunctionValue> = z.object({
  type: z.literal('fn'),
  name: z.string().regex(/^[a-z-]+$/),
  args: z.array(z.lazy(() => CssValue)),
})

export const CssValue: z.ZodType<CssValue> = z.union([ScalarValue, ListValue, FunctionValue])

export const px = (value: number): CssValue => ({ type: 'unit', value, unit: 'px' })
export const rem = (value: number): CssValue => ({ type: 'unit', value, unit: 'rem' })
export const num = (value: number): CssValue => ({ type: 'unit', value, unit: 'number' })
export const kw = (value: string): CssValue => ({ type: 'keyword', value })
export const color = (value: string): CssValue => ({ type: 'color', value })
export const token = (ref: TokenId): CssValue => ({ type: 'token', ref })
export const raw = (value: string): CssValue => ({ type: 'raw', value })
export const list = (values: CssValue[], separator: ' ' | ', ' | ' / ' = ' '): CssValue => ({
  type: 'list',
  separator,
  values,
})
export const fn = (name: string, args: CssValue[]): CssValue => ({ type: 'fn', name, args })
