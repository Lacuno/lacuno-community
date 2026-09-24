import type { CssValue, Document, Node, State } from '@miralo/schema'
import { highlightClass } from './ClassManager.js'
import { sourceLabel, sourceTarget, styleSource } from './presets.js'
import type { StyleControls } from './styleField.js'

/** One muted line under a style field naming where its value comes from. Compact (in the
 * toolbar, where the field already shows the value) keeps only the origin unless inherited.
 * When it names an ancestor, class, preset or token, it is a button that goes there. */
export function SourceLine({
  doc,
  node,
  property,
  breakpoint = 'base',
  state = 'none',
  changes,
  computed,
  compact,
  openPreset,
  openToken,
  select,
}: {
  doc: Document
  node: Node
  property: string
  breakpoint?: string
  state?: State
  changes: Record<string, CssValue | null>
  computed?: Record<string, string>
  compact?: boolean
} & Pick<StyleControls, 'openPreset' | 'openToken' | 'select'>) {
  const source = styleSource(doc, node, property, breakpoint, state, changes)
  const { text, title, origin } = sourceLabel(
    doc,
    source,
    breakpoint,
    state,
    computed?.[property],
    property,
  )
  const shown = compact && origin !== 'inherited' ? origin : text
  const target = sourceTarget(doc, source)
  if (!target)
    return (
      <small className="source" data-source={property} title={title}>
        {shown}
      </small>
    )
  const go = { element: select, class: highlightClass, preset: openPreset, token: openToken }[
    target.to
  ]
  return (
    <button
      type="button"
      className="source"
      data-source={property}
      title={title}
      aria-label={target.label}
      onClick={() => go(target.id)}
    >
      {shown}
    </button>
  )
}
