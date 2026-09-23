import { z } from 'zod'
import { BreakpointId, ClassId } from './ids.js'
import { CssValue } from './values.js'

/**
 * Styling follows the Webflow model. A class is a named style source. A node lists classes in
 * order. Styles are keyed by class, breakpoint, state and property and compile to real CSS rules.
 */

/**
 * Pseudo-classes and pseudo-elements the style panel exposes. The order is the cascade order:
 * state rules share one specificity, so a later one wins and interaction beats structure.
 */
export const State = z.enum([
  'none',
  'first-child',
  'last-child',
  'odd',
  'even',
  'empty',
  'disabled',
  'checked',
  'visited',
  'hover',
  'focus-within',
  'focus',
  'focus-visible',
  'active',
  'placeholder',
  'before',
  'after',
  'marker',
  'selection',
])
export type State = z.infer<typeof State>

export const Class = z.object({
  id: ClassId,
  /**
   * `class` is a named, reusable style source shown in the class panel. `local` is a per-node
   * style source that exists so instance overrides use the same machinery. Local classes have
   * no user-facing name and compile to a generated selector.
   */
  kind: z.enum(['class', 'local']),
  name: z.string().min(1).optional(),
  /**
   * Combo class parents. A class with combo `[a, b]` only applies where a node carries a, b and
   * this class, and compiles to the compound selector `.a.b.this`. Order is significant.
   */
  combo: z.array(ClassId).optional(),
  /** A reusable formatting preset exposed in the editor. */
  preset: z.boolean().optional(),
  locked: z.boolean().optional(),
})
export type Class = z.infer<typeof Class>

export const Breakpoint = z.object({
  id: BreakpointId,
  label: z.string().min(1),
  /** Desktop-first: rules apply at and below this width. The base breakpoint has neither. */
  maxWidth: z.number().int().positive().optional(),
  /** Rules apply at and above this width. For larger-than-desktop breakpoints. */
  minWidth: z.number().int().positive().optional(),
})
export type Breakpoint = z.infer<typeof Breakpoint>

export const BASE_BREAKPOINT_ID = 'base'

/** One declaration. The map key is derived from the four coordinates, see styleKey(). */
export const StyleDecl = z.object({
  class: ClassId,
  breakpoint: BreakpointId,
  state: State,
  property: z.string().regex(/^(-{2})?[a-z][a-z0-9-]*$/, 'property must be kebab-case'),
  value: CssValue,
  important: z.boolean().optional(),
})
export type StyleDecl = z.infer<typeof StyleDecl>

export const STYLE_KEY_SEPARATOR = '|'

export function styleKey(
  d: Pick<StyleDecl, 'class' | 'breakpoint' | 'state' | 'property'>,
): string {
  return [d.class, d.breakpoint, d.state, d.property].join(STYLE_KEY_SEPARATOR)
}
