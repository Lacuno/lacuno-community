import type { Document as SiteDocument } from '@miralo/schema'
import { canContain, type DragItem, type DropPosition, dropTarget } from './structure.js'

export function layoutAxis(
  style: Pick<
    CSSStyleDeclaration,
    'display' | 'flexDirection' | 'gridTemplateColumns' | 'gridAutoFlow' | 'direction'
  >,
) {
  const horizontal = style.display.includes('flex')
    ? style.flexDirection.startsWith('row')
    : style.display.includes('grid') &&
      (style.gridAutoFlow.startsWith('column') ||
        style.gridTemplateColumns
          .replace(/\[[^\]]*\]/g, '')
          .trim()
          .split(/\s+/).length > 1)
  const reverse =
    (style.display.includes('flex') && style.flexDirection.endsWith('reverse')) !==
    (horizontal && style.direction === 'rtl')
  return { horizontal, reverse }
}

/** Hit-test the untouched canvas, never the animated projection displayed above it. */
export function canvasDropTarget(
  surface: Document,
  doc: SiteDocument,
  root: string,
  item: DragItem,
  x: number,
  y: number,
) {
  const view = surface.defaultView
  if (!view) return
  let element = surface.elementFromPoint(x, y)?.closest<HTMLElement>('[data-miralo-node]')
  if (!element) return
  // A container drag must not target its own children (including text under the cursor).
  if ('id' in item) {
    const source = surface.querySelector<HTMLElement>(`[data-miralo-node="${CSS.escape(item.id)}"]`)
    if (source?.contains(element)) element = source
  }
  const chain: HTMLElement[] = []
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    if (current.dataset.miraloNode) chain.push(current)
  }
  const candidate = (target: HTMLElement, edgeOnly: boolean) => {
    const id = target.dataset.miraloNode!
    if (!doc.nodes[id]) return
    const rect = target.getBoundingClientRect()
    const { horizontal, reverse } = layoutAxis(
      view.getComputedStyle(target.parentElement ?? target),
    )
    const size = horizontal ? rect.width : rect.height
    const offset = horizontal ? x - rect.left : y - rect.top
    const edge = Math.min(24, size * 0.25)
    if (edgeOnly && (id === root || (offset > edge && offset < size - edge))) return
    const inside =
      canContain(doc, id) &&
      (id === root || (offset > edge && offset < size - edge)) &&
      !('id' in item && item.id === id)
    const position: DropPosition = inside
      ? 'inside'
      : offset < size / 2 !== reverse
        ? 'before'
        : 'after'
    try {
      const destination = dropTarget(doc, root, item, id, position)
      return { ...destination, id, position, rect, horizontal, leading: offset < size / 2 }
    } catch {
      return
    }
  }
  // Edges belong to the outer container, even when a text child fills that edge.
  for (const ancestor of chain.slice(1).reverse()) {
    const target = candidate(ancestor, true)
    if (target) return target
  }
  return candidate(element, false)
}
