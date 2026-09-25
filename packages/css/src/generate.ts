import type { AssetRef, Breakpoint, Document, State, StyleDecl } from '@lacuno/schema'
import { BASE_BREAKPOINT_ID, designTokenCssName, State as StateSchema } from '@lacuno/schema'
import { isMotionStyle, MOTION_CSS } from './motion.js'
import { compareProperties } from './order.js'
import { type ClassNames, classNames, compareSelectors, selectorFor } from './selector.js'
import { contextFromDocument, serializeValue, type ValueContext } from './value.js'

export type GenerateOptions = {
  /** Resolve an asset to a URL for `url()` values. */
  assetUrl?: (asset: AssetRef) => string
  /** Emit a small reset before site rules. On by default. */
  reset?: boolean
  /** Also emit each state rule in its forced form, for the editor canvas only. */
  previewStates?: boolean
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
const RESET = `*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; min-height: 100dvh; }
img, video, svg { display: block; max-width: 100%; height: auto; }
button, input, select, textarea { font: inherit; color: inherit; }
a { color: inherit; }`

/** Emit `:root` design tokens for the default mode and overrides per extra mode. */
function generateDesignTokens(doc: Document, ctx: ValueContext): string {
  const modes = doc.site.modes
  const def = modes.find((m) => m.default) ?? modes[0]
  if (!def) return ''
  const designTokens = Object.values(doc.designTokens).sort((a, b) => (a.name < b.name ? -1 : 1))
  const lines = (mode: string): string[] =>
    designTokens
      .map((t) => {
        const v = t.values[mode]
        return v ? `  ${designTokenCssName(t.name)}: ${serializeValue(v, ctx)};` : undefined
      })
      .filter((l): l is string => !!l)
  const blocks: string[] = []

  const rootLines = lines(def.id)
  if (rootLines.length) blocks.push(`:root {\n${rootLines.join('\n')}\n}`)

  for (const mode of modes) {
    if (mode === def) continue
    const own = lines(mode.id)
    if (!own.length) continue
    const body = own.join('\n')
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
  previewStates: boolean,
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
  const classIds = [...byClass.keys()].sort(compareSelectors(doc, names))

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
        `${indent}${selectorFor(doc, names, classId, state, previewStates)} {\n${lines.join('\n')}\n${indent}}`,
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
    const body = generateRules(doc, names, ctx, own, mq ? '  ' : '', !!options.previewStates)
    sections.push(mq ? `${mq} {\n${body}\n}` : body)
  }

  if (decls.some(isMotionStyle)) sections.push(MOTION_CSS)
  return { css: `${sections.join('\n\n')}\n`, classNames: names }
}

/** A stylesheet inlined in HTML: `<` becomes the CSS escape `\3c ` so it cannot close the element. */
export function styleElement(css: string): string {
  return `<style>${css.replace(/</g, '\\3c ')}</style>`
}
