import type {
  AssetRef,
  Breakpoint,
  DesignTokenGroup,
  Document,
  State,
  StyleDecl,
} from '@lacuno/schema'
import {
  BASE_BREAKPOINT_ID,
  designTokenCssName,
  RichTag,
  State as StateSchema,
} from '@lacuno/schema'
import { isMotionStyle, isStory, keyframesCss, MOTION_CSS, SCROLL_CSS, storyCss } from './motion.js'
import { compareProperties } from './order.js'
import { type ClassNames, classNames, compareSelectors, selectorFor } from './selector.js'
import { hasTable, TABLE_CSS } from './table.js'
import { contextFromDocument, serializeValue, type ValueContext } from './value.js'
import { wordsCss } from './words.js'

export type GenerateOptions = {
  /** Resolve an asset to a URL for `url()` values. */
  assetUrl?: (asset: AssetRef) => string
  /** Emit a small reset before site rules. On by default. */
  reset?: boolean
  /** Also emit each state rule in its forced form, for the editor canvas only. */
  previewStates?: boolean
}

/** A design token as it compiles for one mode: `value` is exactly what the stylesheet sets. */
export type CompiledToken = {
  name: string
  cssName: string
  group: DesignTokenGroup
  value: string
}

export type Stylesheet = {
  css: string
  classNames: ClassNames
  /** The `:root` design tokens, those of the default mode. */
  tokens: CompiledToken[]
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

function modeTokens(doc: Document, mode: string, ctx: ValueContext): CompiledToken[] {
  return Object.values(doc.designTokens)
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((t) => {
      const v = t.values[mode]
      if (!v) return []
      const value = serializeValue(v, ctx)
      return [{ name: t.name, cssName: designTokenCssName(t.name), group: t.group, value }]
    })
}

/** Emit `:root` design tokens for the default mode and overrides per extra mode. */
function generateDesignTokens(doc: Document, root: CompiledToken[], ctx: ValueContext): string {
  const lines = (tokens: CompiledToken[]): string[] =>
    tokens.map((t) => `  ${t.cssName}: ${t.value};`)
  const def = defaultMode(doc)
  const blocks: string[] = []

  const rootLines = lines(root)
  if (rootLines.length) blocks.push(`:root {\n${rootLines.join('\n')}\n}`)

  for (const mode of doc.site.modes) {
    if (mode === def) continue
    const own = lines(modeTokens(doc, mode.id, ctx))
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

function defaultMode(doc: Document) {
  return doc.site.modes.find((m) => m.default) ?? doc.site.modes[0]
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

/**
 * Rules for one breakpoint: grouped by class, the class's own rules before its rich-text tags,
 * then by state, with sorted properties.
 */
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
  const byClass = new Map<string, Map<RichTag | '', Map<State, StyleDecl[]>>>()
  for (const d of decls) {
    let tags = byClass.get(d.class)
    if (!tags) {
      tags = new Map()
      byClass.set(d.class, tags)
    }
    let states = tags.get(d.tag ?? '')
    if (!states) {
      states = new Map()
      tags.set(d.tag ?? '', states)
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
    const tags = byClass.get(classId) as Map<RichTag | '', Map<State, StyleDecl[]>>
    for (const tag of ['', ...RichTag.options] as const) {
      const states = tags.get(tag)
      if (!states) continue
      for (const state of STATE_ORDER) {
        const list = states.get(state)
        if (!list) continue
        const lines = [...list]
          .sort((a, b) => compareProperties(a.property, b.property))
          .map(
            (d) =>
              `${indent}  ${d.property}: ${serializeValue(d.value, ctx)}${d.important ? ' !important' : ''};`,
          )
        const selector = selectorFor(doc, names, classId, state, previewStates, tag || undefined)
        rules.push(`${indent}${selector} {\n${lines.join('\n')}\n${indent}}`)
      }
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
  const def = defaultMode(doc)
  const tokens = def ? modeTokens(doc, def.id, ctx) : []
  const designTokens = generateDesignTokens(doc, tokens, ctx)
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
  if (decls.some((d) => d.property === '--lc-scroll') || Object.values(doc.nodes).some(isStory)) {
    sections.push(SCROLL_CSS)
    const stories = storyCss(doc)
    if (stories) sections.push(stories)
  }
  const keyframes = keyframesCss(doc, ctx)
  if (keyframes) sections.push(keyframes)
  const words = wordsCss(doc)
  if (words) sections.push(words)
  if (hasTable(doc)) sections.push(TABLE_CSS)
  return { css: `${sections.join('\n\n')}\n`, classNames: names, tokens }
}

/** A stylesheet inlined in HTML: `<` becomes the CSS escape `\3c ` so it cannot close the element. */
export function styleElement(css: string): string {
  return `<style>${css.replace(/</g, '\\3c ')}</style>`
}
