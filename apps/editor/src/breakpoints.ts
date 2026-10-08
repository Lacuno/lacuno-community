import type { Document } from '@lacuno/schema'

export function editingBreakpoint(doc: Document, width: number): string {
  return (
    Object.values(doc.breakpoints)
      .filter(
        (bp) =>
          bp.maxWidth !== undefined &&
          width <= bp.maxWidth &&
          (bp.minWidth === undefined || width >= bp.minWidth),
      )
      .sort((a, b) => a.maxWidth! - b.maxWidth!)[0]?.id ?? 'base'
  )
}

/** Match the canvas presets where possible, otherwise use a width within the custom range. */
export function breakpointWidth(doc: Document, id: string): number {
  const preferred = (
    { base: 1100, tablet: 768, 'mobile-l': 600, 'mobile-p': 390 } as Record<string, number>
  )[id]
  if (preferred && editingBreakpoint(doc, preferred) === id) return preferred
  const bp = doc.breakpoints[id]
  return (
    bp?.maxWidth ??
    Math.max(
      1100,
      bp?.minWidth ?? 0,
      ...Object.values(doc.breakpoints).map((item) => (item.maxWidth ?? 0) + 1),
    )
  )
}
export function breakpointMedia(doc: Document, id: string): string | undefined {
  const bp = doc.breakpoints[id]
  if (!bp) return undefined
  const parts = []
  if (bp.minWidth !== undefined) parts.push(`(min-width: ${bp.minWidth}px)`)
  if (bp.maxWidth !== undefined) parts.push(`(max-width: ${bp.maxWidth}px)`)
  return parts.length ? parts.join(' and ') : undefined
}
export function inheritedBreakpoints(doc: Document, id: string): string[] {
  if (id === 'base') return ['base']
  const selected = doc.breakpoints[id]
  const width = selected?.maxWidth ?? selected?.minWidth ?? Infinity
  return [
    'base',
    ...Object.values(doc.breakpoints)
      .filter(
        (bp) =>
          bp.id !== 'base' &&
          (bp.maxWidth !== undefined || bp.minWidth !== undefined) &&
          (bp.maxWidth === undefined || width <= bp.maxWidth) &&
          (bp.minWidth === undefined || width >= bp.minWidth),
      )
      .sort(
        (a, b) =>
          (b.maxWidth ?? Infinity) - (a.maxWidth ?? Infinity) ||
          (a.minWidth ?? 0) - (b.minWidth ?? 0),
      )
      .map((bp) => bp.id),
  ]
}
