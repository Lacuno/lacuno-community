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
  'open',
  'target',
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

/**
 * The tags rich text renders, which a class may style inside the blocks that carry it: `h2` on
 * the class `legal` compiles to `.legal h2`. A fixed list, so no declaration becomes an arbitrary
 * selector.
 */
export const RichTag = z.enum([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'a',
  'strong',
  'em',
  'code',
  'pre',
  'blockquote',
  'ul',
  'ol',
  'li',
  'hr',
  'table',
  'tr',
  'th',
  'td',
])
export type RichTag = z.infer<typeof RichTag>

/** One declaration. The map key is derived from its coordinates, see styleKey(). */
/** The states a parent can be in for a style that follows it. */
export const PARENT_STATES: readonly State[] = ['hover', 'focus-within', 'open', 'target']

export const StyleDecl = z.object({
  class: ClassId,
  /** A rich-text tag inside the elements carrying the class, instead of those elements. */
  tag: RichTag.optional(),
  breakpoint: BreakpointId,
  state: State,
  /** A parent's class: the state is that parent's, as in `.card:hover .photo`. */
  of: ClassId.optional(),
  /**
   * A kebab-case property, a custom `--` one, or a `-webkit-` or `-moz-` one the published CSS
   * cannot add itself, such as `-webkit-font-smoothing` or `-webkit-line-clamp`.
   */
  property: z
    .string()
    .regex(
      /^(--|-webkit-|-moz-)?[a-z][a-z0-9-]*$/,
      'property must be kebab-case: a --custom one, or -webkit- or -moz- before a vendor one',
    ),
  value: CssValue,
  important: z.boolean().optional(),
})
export type StyleDecl = z.infer<typeof StyleDecl>

/** Why a style's `of` cannot be, or nothing. */
export function parentStateError(d: Pick<StyleDecl, 'state' | 'of' | 'tag'>): string | undefined {
  if (!d.of) return undefined
  if (d.tag) return 'of cannot go with tag'
  if (!PARENT_STATES.includes(d.state))
    return `of follows a parent's ${PARENT_STATES.join(', ')}, not ${d.state}`
  return undefined
}

/** A style's state as one value: its own, or `hover@c-card` for a parent's. Ids hold no `@`. */
export type StateKey = State | `${State}@${string}`

export const stateKey = (d: Pick<StyleDecl, 'state' | 'of'>): StateKey =>
  d.of ? `${d.state}@${d.of}` : d.state

/** A state key as the coordinates a style takes. */
export function stateCoordinates(key: StateKey): { state: State; of?: string } {
  const [state, of] = key.split('@') as [State, string?]
  return of ? { state, of } : { state }
}

export const STYLE_KEY_SEPARATOR = '|'

/**
 * `class|breakpoint|state|property`, with the tag after the class when there is one and a
 * parent's state as `hover@c-card`.
 */
export function styleKey(
  d: Pick<StyleDecl, 'class' | 'tag' | 'breakpoint' | 'state' | 'of' | 'property'>,
): string {
  return [d.class, ...(d.tag ? [d.tag] : []), d.breakpoint, stateKey(d), d.property].join(
    STYLE_KEY_SEPARATOR,
  )
}
