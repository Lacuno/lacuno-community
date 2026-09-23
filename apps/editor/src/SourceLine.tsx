import type { CssValue, Document, Node, State } from '@freeflow/schema'
import { sourceLabel, styleSource } from './presets.js'

/** One muted line under a style field naming where its value comes from. */
export function SourceLine({
  doc,
  node,
  property,
  breakpoint = 'base',
  state = 'none',
  changes,
}: {
  doc: Document
  node: Node
  property: string
  breakpoint?: string
  state?: State
  changes: Record<string, CssValue | null>
}) {
  const label = sourceLabel(
    doc,
    styleSource(doc, node, property, breakpoint, state, changes),
    breakpoint,
    state,
  )
  return (
    <small className="source" data-source={property} title={label}>
      {label}
    </small>
  )
}
