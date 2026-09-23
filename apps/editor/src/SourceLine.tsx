import type { CssValue, Document, Node, State } from '@freeflow/schema'
import { sourceLabel, styleSource } from './presets.js'

/** One muted line under a style field naming where its value comes from. Compact (in the
 * toolbar, where the field already shows the value) keeps only the origin unless inherited. */
export function SourceLine({
  doc,
  node,
  property,
  breakpoint = 'base',
  state = 'none',
  changes,
  computed,
  compact,
}: {
  doc: Document
  node: Node
  property: string
  breakpoint?: string
  state?: State
  changes: Record<string, CssValue | null>
  computed?: Record<string, string>
  compact?: boolean
}) {
  const { text, title, origin } = sourceLabel(
    doc,
    styleSource(doc, node, property, breakpoint, state, changes),
    breakpoint,
    state,
    computed?.[property],
    property,
  )
  return (
    <small className="source" data-source={property} title={title}>
      {compact && origin !== 'inherited' ? origin : text}
    </small>
  )
}
