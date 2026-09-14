import { z } from 'zod'
import { ModeId, TokenId } from './ids.js'
import { CssValue } from './values.js'

/**
 * Design tokens are named values with a value per mode. They compile to CSS custom properties.
 * Modes are defined on the site, e.g. light and dark, and a token may leave a mode undefined to
 * inherit the default mode's value.
 */
export const TokenGroup = z.enum([
  'color',
  'spacing',
  'size',
  'typography',
  'radius',
  'shadow',
  'border',
  'motion',
  'other',
])
export type TokenGroup = z.infer<typeof TokenGroup>

export const Token = z.object({
  id: TokenId,
  /** Dot-separated path such as `color.brand.primary`. Compiles to `--color-brand-primary`. */
  name: z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'token names are lower-case dot paths'),
  group: TokenGroup,
  values: z.record(ModeId, CssValue),
  description: z.string().optional(),
})
export type Token = z.infer<typeof Token>

export const Mode = z.object({
  id: ModeId,
  label: z.string().min(1),
  /** Exactly one mode per site is the default and defines the `:root` values. */
  default: z.boolean().optional(),
  /** Selector that activates the mode, e.g. `[data-theme="dark"]`. */
  selector: z.string().optional(),
  /** Media query that activates the mode when no selector is forcing one. */
  media: z.string().optional(),
})
export type Mode = z.infer<typeof Mode>

export function tokenCssName(name: string): string {
  return `--${name.replace(/\./g, '-')}`
}
