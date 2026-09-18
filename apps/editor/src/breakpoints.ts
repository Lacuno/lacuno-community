import type { Document } from '@freeflow/schema'

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
