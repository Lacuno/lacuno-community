import type { Breakpoint, Document, State, StyleDecl } from '@freeflow/schema'
import { BASE_BREAKPOINT_ID, designTokenCssName, State as StateSchema } from '@freeflow/schema'
import { MOTION_CSS } from './motion.js'
import { compareProperties } from './order.js'
import { type ClassNames, classNames, selectorFor } from './selector.js'
import { contextFromDocument, serializeValue, type ValueContext } from './value.js'

export type GenerateOptions = {
  /** Resolve an asset id to a URL for `url()` values. */
  assetUrl?: (id: string) => string | undefined
  /** Emit a small reset before site rules. On by default. */
  reset?: boolean
}

export type Stylesheet = {
  css: string
  classNames: ClassNames
}

const STATE_ORDER: readonly State[] = StateSchema.options

/**
 * A minimal, opinionated reset. Enough that the box model behaves and no more, so the site's
 * own classes stay in charge.
 */
export const RESET = `*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; min-height: 100dvh; }
img, video, svg { display: block; max-width: 100%; height: auto; }
button, input, select, textarea { font: inherit; color: inherit; }
a { color: inherit; }`

/** Emit `:root` design tokens for the default mode and overrides per extra mode. */
export function generateDesignTokens(doc: Document, ctx: ValueContext): string {
  const modes = doc.site.modes
  const def = modes.find((m) => m.default) ?? modes[0]
  if (!def) return ''
  const designTokens = Object.values(doc.designTokens).sort((a, b) => (a.name < b.name ? -1 : 1))
  const blocks: string[] = []

  const rootLines = designTokens
    .map((t) => {
      const v = t.values[def.id]
      return v ? `  ${designTokenCssName(t.name)}: ${serializeValue(v, ctx)};` : undefined
    })
    .filter((l): l is string => !!l)
  if (rootLines.length) blocks.push(`:root {\n${rootLines.join('\n')}\n}`)

  for (const mode of modes) {
    if (mode === def) continue
    const lines = designTokens
      .map((t) => {
        const v = t.values[mode.id]
        return v ? `  ${designTokenCssName(t.name)}: ${serializeValue(v, ctx)};` : undefined
      })
      .filter((l): l is string => !!l)
    if (!lines.length) continue
    const body = lines.join('\n')
    if (mode.media) {
      // Media applies only when no explicit theme is forced on the root.
      blocks.push(
        `@media ${mode.media} {\n  :root:not([data-theme]) {\n${body.replace(/^/gm, '  ')}\n  }\n}`,
      )
    }
    if (mode.selector) blocks.push(`${mode.selector} {\n${body}\n}`)
  }
  return blocks.join('\n')
}

function breakpointOrder(doc: Document): Breakpoint[] {
  const all = Object.values(doc.breakpoints)
  const base = all.filter((b) => b.id === BASE_BREAKPOINT_ID)
  const max = all
    .filter((b) => b.maxWidth !== undefined)
    .sort((a, b) => (b.maxWidth as number) - (a.maxWidth as number))
  const min = all
    .filter(
      (b) => b.id !== BASE_BREAKPOINT_ID && b.maxWidth === undefined && b.minWidth !== undefined,
    )
    .sort((a, b) => (a.minWidth as number) - (b.minWidth as number))
  return [...base, ...max, ...min]
}

function mediaQuery(b: Breakpoint): string | undefined {
  if (b.id === BASE_BREAKPOINT_ID) return undefined
  const parts: string[] = []
  if (b.minWidth !== undefined) parts.push(`(min-width: ${b.minWidth}px)`)
  if (b.maxWidth !== undefined) parts.push(`(max-width: ${b.maxWidth}px)`)
  return parts.length ? `@media ${parts.join(' and ')}` : undefined
}

/** Rules for one breakpoint: grouped by class (in first-use order), then state, sorted properties. */
function generateRules(
  doc: Document,
  names: ClassNames,
  ctx: ValueContext,
  decls: StyleDecl[],
  indent: string,
): string {
  // Class emission order: sorted by output selector so combos come after their parents
  // (".a.b" > ".a") and the cascade is predictable.
  const byClass = new Map<string, Map<State, StyleDecl[]>>()
  for (const d of decls) {
    let states = byClass.get(d.class)
    if (!states) {
      states = new Map()
      byClass.set(d.class, states)
    }
    let list = states.get(d.state)
    if (!list) {
      list = []
      states.set(d.state, list)
    }
    list.push(d)
  }
  const classIds = [...byClass.keys()].sort((a, b) => {
    const sa = selectorFor(doc, names, a, 'none')
    const sb = selectorFor(doc, names, b, 'none')
    // Fewer compound parts first, then alphabetical.
    const da = sa.split('.').length
    const db = sb.split('.').length
    if (da !== db) return da - db
    return sa < sb ? -1 : sa > sb ? 1 : 0
  })

  const rules: string[] = []
  for (const classId of classIds) {
    const states = byClass.get(classId) as Map<State, StyleDecl[]>
    for (const state of STATE_ORDER) {
      const list = states.get(state)
      if (!list) continue
      const lines = [...list]
        .sort((a, b) => compareProperties(a.property, b.property))
        .map(
          (d) =>
            `${indent}  ${d.property}: ${serializeValue(d.value, ctx)}${d.important ? ' !important' : ''};`,
        )
      rules.push(
        `${indent}${selectorFor(doc, names, classId, state)} {\n${lines.join('\n')}\n${indent}}`,
      )
    }
  }
  return rules.join('\n')
}

/** Document to a complete, deterministic stylesheet. */
export function generateStylesheet(doc: Document, options: GenerateOptions = {}): Stylesheet {
  const ctx = contextFromDocument(doc, options.assetUrl)
  const names = classNames(doc)
  const sections: string[] = []

  if (options.reset !== false) sections.push(RESET)
  const designTokens = generateDesignTokens(doc, ctx)
  if (designTokens) sections.push(designTokens)

  const decls = Object.values(doc.styles)
  for (const bp of breakpointOrder(doc)) {
    const own = decls.filter((d) => d.breakpoint === bp.id)
    if (!own.length) continue
    const mq = mediaQuery(bp)
    const body = generateRules(doc, names, ctx, own, mq ? '  ' : '')
    sections.push(mq ? `${mq} {\n${body}\n}` : body)
  }

  const motion = decls.filter((style) => style.property.startsWith('--ff-'))
  if (motion.length) {
    sections.push(MOTION_CSS)
    for (const style of motion.filter((item) => item.property.startsWith('--ff-hover-'))) {
      const property = style.property.slice('--ff-hover-'.length)
      if (!['opacity', 'scale', 'rotate', 'box-shadow'].includes(property)) continue
      const selector = selectorFor(doc, names, style.class, 'none')
      const rule = `${selector}:hover, ${selector}:focus-visible, ${selector}[data-ff-hover-preview] { ${property}: var(${style.property}) !important; }`
      sections.push(`@media (prefers-reduced-motion: no-preference) { ${rule} }`)
    }
  }
  return { css: `${sections.join('\n\n')}\n`, classNames: names }
}
