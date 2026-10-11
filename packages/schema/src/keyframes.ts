import { z } from 'zod'
import { StyleDecl } from './styles.js'
import { CssValue } from './values.js'

/**
 * A keyframes record's id is its CSS name, chosen by the author and used verbatim in
 * `@keyframes` and as the value of `--lc-entrance` or `--lc-scroll`: a lower-case ident, not a
 * preset's `lc-` name, `none` or a CSS-wide keyword.
 */
export const KeyframesId = z
  .string()
  .regex(
    /^(?!lc-)(?!(none|initial|inherit|unset|revert|revert-layer|default)$)[a-z][a-z0-9-]*$/,
    'keyframes ids are lower-case idents, not lc-* or none',
  )

/** One stop: a percentage of the animation and the styles there, keyed by kebab-case property. */
export const KeyframeStop = z.object({
  at: z.number().min(0).max(100),
  styles: z.record(StyleDecl.shape.property, CssValue),
})
export type KeyframeStop = z.infer<typeof KeyframeStop>

/** Custom keyframes, stops sorted by `at`, each `at` once. A stop left out means "as styled". */
export const Keyframes = z.object({
  id: KeyframesId,
  stops: z.array(KeyframeStop).min(1),
})
export type Keyframes = z.infer<typeof Keyframes>
