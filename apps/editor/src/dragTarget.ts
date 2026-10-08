import { isDescendant } from '@lacuno/document/references'
import type { Document as SiteDocument } from '@lacuno/schema'
import { type DragItem, dropTarget, wrapTarget } from './structure.js'

export type Flow = { horizontal: boolean; reverse: boolean }
type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>

/** A structural drop between children, or a Row with a rested-on sibling. Alignment is explicit. */
export type DropSlot = {
  parent: string
  index: number
  slot: number
  flow: Flow
  boxes: Box[]
  wrap?: string
  first?: boolean
}

/**
 * How long the pointer rests on a sibling before a drop goes into it, or on its side makes a Row
 * of the two, instead of beside it.
 */
export const DWELL = 800

export function layoutAxis(
  style: Pick<
    CSSStyleDeclaration,
    'display' | 'flexDirection' | 'gridTemplateColumns' | 'gridAutoFlow' | 'direction'
  >,
): Flow {
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

const middle = (a: number, b: number) => (a + b) / 2

// In a horizontal flow a child that starts past the line's trailing edge continues the line,
// whatever its alignment across it; one that starts back before it has wrapped.
const continues = (edge: number, box: Box, reverse: boolean) =>
  reverse ? box.right <= edge + 1 : box.left >= edge - 1

/**
 * The number of children before the point along the parent's flow. A vertical flow compares
 * vertical midpoints; a horizontal one picks the wrapped line under the point, then compares
 * horizontal midpoints within it.
 */
export function insertionIndex(boxes: Box[], x: number, y: number, { horizontal, reverse }: Flow) {
  const before = (start: number, end: number, at: number) =>
    reverse ? middle(start, end) > at : middle(start, end) < at
  if (!horizontal) return boxes.filter((box) => before(box.top, box.bottom, y)).length
  let start = 0
  let bottom = Number.NEGATIVE_INFINITY
  let edge = reverse ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  for (let index = 0; index <= boxes.length; index++) {
    const box = boxes[index]
    if (box && (index === start || box.top < bottom - 1 || continues(edge, box, reverse))) {
      bottom = Math.max(bottom, box.bottom)
      edge = reverse ? Math.min(edge, box.left) : Math.max(edge, box.right)
      continue
    }
    if (y < bottom || !box) {
      const line = boxes.slice(start, index)
      return start + line.filter((item) => before(item.left, item.right, x)).length
    }
    start = index
    bottom = box.bottom
    edge = reverse ? box.left : box.right
  }
  return 0
}

/** insertionIndex, keeping the previous slot while the point is within `slack` px of it. */
export function stableIndex(
  boxes: Box[],
  x: number,
  y: number,
  flow: Flow,
  previous: number | undefined,
  slack = 8,
) {
  const [dx, dy] = flow.horizontal ? [slack, 0] : [0, slack]
  const a = insertionIndex(boxes, x - dx, y - dy, flow)
  const b = insertionIndex(boxes, x + dx, y + dy, flow)
  if (previous !== undefined && previous >= Math.min(a, b) && previous <= Math.max(a, b))
    return previous
  return insertionIndex(boxes, x, y, flow)
}

/** The insertion line between the slot's neighbours, across the flow; none in an empty parent. */
export function insertionLine(
  { boxes, slot, flow }: Pick<DropSlot, 'boxes' | 'slot' | 'flow'>,
  y: number,
  thickness: number,
) {
  const previous = boxes[slot - 1]
  const next = boxes[slot]
  const { horizontal, reverse } = flow
  // The side of a child that faces the children after it, and the side facing those before it.
  const trailing = (box: Box) =>
    horizontal ? (reverse ? box.left : box.right) : reverse ? box.top : box.bottom
  const leading = (box: Box) =>
    horizontal ? (reverse ? box.right : box.left) : reverse ? box.bottom : box.top
  // Wrapped neighbours sit on different lines; the line goes by the one nearer the pointer.
  const sameLine =
    !horizontal ||
    !previous ||
    !next ||
    (previous.top < next.bottom && next.top < previous.bottom) ||
    continues(trailing(previous), next, reverse)
  const nearNext =
    next &&
    (!previous ||
      Math.abs(y - middle(next.top, next.bottom)) <
        Math.abs(y - middle(previous.top, previous.bottom)))
  const neighbours = sameLine
    ? [previous, next].filter((box) => !!box)
    : [nearNext ? next! : previous!]
  if (!neighbours.length) return
  const at =
    previous && next && sameLine
      ? middle(trailing(previous), leading(next))
      : neighbours[0] === next
        ? leading(next!)
        : trailing(previous!)
  const from = Math.min(...neighbours.map((box) => (horizontal ? box.top : box.left)))
  const to = Math.max(...neighbours.map((box) => (horizontal ? box.bottom : box.right)))
  return horizontal
    ? { left: at - thickness / 2, top: from, width: thickness, height: to - from }
    : { left: from, top: at - thickness / 2, width: to - from, height: thickness }
}

const valid = (doc: SiteDocument, root: string, item: DragItem, parent: string) => {
  try {
    dropTarget(doc, root, item, parent, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Drop slots on the canvas. The layout never moves during a drag, so each box is measured once
 * and again only after a scroll. The pointer goes into the deepest container whose inner area it
 * is over; a container's edges along its parent's flow mean before or after it. A dragged element
 * stays among its siblings until the pointer rests for DWELL ms inside one of them, or on a
 * sibling's side to make a Row of the two.
 */
export function canvasSlots(surface: Document, doc: SiteDocument, root: string, item: DragItem) {
  const view = surface.defaultView!
  const elements = new Map<string, HTMLElement>()
  for (const element of surface.querySelectorAll<HTMLElement>('[data-lacuno-node]'))
    if (!elements.has(element.dataset.lacunoNode!))
      elements.set(element.dataset.lacunoNode!, element)
  const boxes = new Map<string, DOMRect | undefined>()
  const box = (id: string) => {
    if (!boxes.has(id)) {
      const element = elements.get(id)
      boxes.set(id, element?.getClientRects().length ? element.getBoundingClientRect() : undefined)
    }
    return boxes.get(id)
  }
  const flows = new Map<string, Flow>()
  const flow = (id: string) => {
    if (!flows.has(id)) {
      const element = elements.get(id)
      flows.set(
        id,
        element
          ? layoutAxis(view.getComputedStyle(element))
          : { horizontal: false, reverse: false },
      )
    }
    return flows.get(id)!
  }
  const dragged = 'id' in item ? item.id : undefined
  const home = dragged ? doc.nodes[dragged]?.parent : undefined
  const contains = (rect: Box, x: number, y: number) =>
    x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
  let previous: DropSlot | undefined
  let rest = { on: '', x: 0, y: 0, since: 0 }
  const locate = (x: number, y: number, now = performance.now()): DropSlot | undefined => {
    // The nearest rendered node of this page under the point; a component's insides are not.
    let hit = surface.elementFromPoint(x, y)?.closest<HTMLElement>('[data-lacuno-node]')
    const inPage = (id: string) => id === root || isDescendant(doc, root, id)
    while (hit && !inPage(hit.dataset.lacunoNode!))
      hit = hit.parentElement?.closest<HTMLElement>('[data-lacuno-node]')
    let parent: string | undefined
    for (
      let id: string | null | undefined = hit?.dataset.lacunoNode ?? root;
      id;
      id = doc.nodes[id]?.parent
    ) {
      const rect = box(id)
      if (!rect || !valid(doc, root, item, id)) continue
      const outer = doc.nodes[id]?.parent
      if (id !== root && outer) {
        const along = flow(outer).horizontal
        const [start, end, at] = along ? [rect.left, rect.right, x] : [rect.top, rect.bottom, y]
        const edge = Math.min(24, (end - start) / 4)
        if (at < start + edge || at > end - edge) continue
      }
      parent = id
      break
    }
    if (!parent) return
    // Resting still for DWELL ms settles the drop on what is under the pointer: a sibling
    // container's inside, or a sibling's side in a Row with it. Moving more than 8 px, or onto
    // something else, starts over, so passing over either only reorders.
    const resting = (on: string) => {
      if (rest.on !== on || Math.hypot(x - rest.x, y - rest.y) > 8) rest = { on, x, y, since: now }
      return !!on && now - rest.since >= DWELL
    }
    const nest =
      home &&
      parent !== home &&
      isDescendant(doc, home, parent) &&
      doc.nodes[parent]!.children.length
    if (nest && !resting(parent)) parent = home!
    const children = doc.nodes[parent]!.children
    const laidOut = children.filter((id) => box(id))
    const flowOf = flow(parent)
    const rects = laidOut.map((id) => box(id)!)
    const common = { parent, flow: flowOf, boxes: rects }
    // On the outer quarter of a sibling's side, where a vertical flow has no before or after, the
    // two become a Row; in a horizontal flow the sides already mean before and after. A sibling
    // container's inside claims the rest, so no side is offered while the pointer is in one.
    const over = flowOf.horizontal
      ? undefined
      : laidOut.find((id) => id !== dragged && contains(box(id)!, x, y))
    const rect = over && box(over)!
    const first = rect ? x < rect.left + (rect.right - rect.left) / 4 : false
    const last = rect ? x > rect.right - (rect.right - rect.left) / 4 : false
    const side =
      over && (first || last) && typeof wrapTarget(doc, over, 'row') !== 'string' ? over : ''
    if (!nest && resting(side)) {
      previous = {
        ...common,
        slot: laidOut.indexOf(side),
        index: children.indexOf(side),
        wrap: side,
        first,
      }
      return previous
    }
    const slot = stableIndex(
      rects,
      x,
      y,
      flowOf,
      previous?.parent === parent ? previous.slot : undefined,
    )
    previous = {
      ...common,
      slot,
      index: slot < laidOut.length ? children.indexOf(laidOut[slot]!) : children.length,
    }
    return previous
  }
  return {
    locate,
    box: (id: string) => box(id),
    /** Measure again, after the canvas scrolled or resized. */
    remeasure: () => {
      boxes.clear()
      flows.clear()
    },
  }
}

/** Layer rows are indented by this much per level. */
export const INDENT = 14

/** How deep a node's layer row is indented below the root's. */
export function layerDepth(doc: SiteDocument, root: string, id: string) {
  let depth = 0
  for (let current = id; current !== root && doc.nodes[current]?.parent; depth++)
    current = doc.nodes[current]!.parent!
  return depth
}

/**
 * Drop slots in the layers list. The middle of a container's row drops into it; between rows,
 * the pointer's horizontal travel from where the drag started picks the depth, the way a
 * tree outline indents.
 */
export function layerSlots(
  panel: HTMLElement,
  doc: SiteDocument,
  root: string,
  item: DragItem,
  grab: { x: number; depth: number } | undefined,
) {
  const depthOf = (id: string) => layerDepth(doc, root, id)
  let rows: { id: string; depth: number; rect: DOMRect }[] | undefined
  const measure = () => {
    rows ??= [...panel.querySelectorAll<HTMLElement>('[data-drag-node]')].map((element) => {
      const id = element.dataset.dragNode!
      return { id, depth: depthOf(id), rect: element.parentElement!.getBoundingClientRect() }
    })
    return rows
  }
  const locate = (x: number, y: number) => {
    const all = measure()
    const over = all.find((row) => y >= row.rect.top && y < row.rect.bottom)
    if (over) {
      const fraction = (y - over.rect.top) / over.rect.height
      if (fraction > 0.25 && fraction < 0.75 && valid(doc, root, item, over.id))
        return { parent: over.id, index: doc.nodes[over.id]!.children.length, row: over }
    }
    const gap = all.filter((row) => middle(row.rect.top, row.rect.bottom) < y).length
    const above = all[gap - 1]
    const below = all[gap]
    if (!above) return
    const deepest = above.depth + 1
    const shallowest = below ? below.depth : 1
    const left = above.rect.left + 6 + 18
    const wanted = grab
      ? grab.depth + Math.round((x - grab.x) / INDENT)
      : Math.round((x - left) / INDENT)
    // The nearest allowed depth to the wanted one, deepest first on a tie.
    const depths = Array.from({ length: deepest - shallowest + 1 }, (_, i) => deepest - i).sort(
      (a, b) => Math.abs(a - wanted) - Math.abs(b - wanted),
    )
    for (const depth of depths) {
      let parent: string
      let index: number
      if (depth === deepest) {
        parent = above.id
        // A container that is open shows its children next; a closed one takes the drop last.
        index =
          below && doc.nodes[below.id]?.parent === above.id
            ? 0
            : doc.nodes[above.id]!.children.length
      } else {
        let sibling = above.id
        for (let level = above.depth; level > depth; level--) sibling = doc.nodes[sibling]!.parent!
        parent = doc.nodes[sibling]!.parent!
        index = doc.nodes[parent]!.children.indexOf(sibling) + 1
      }
      if (!valid(doc, root, item, parent)) continue
      const top = below ? middle(above.rect.bottom, below.rect.top) : above.rect.bottom
      return { parent, index, line: { left: left + depth * INDENT, top } }
    }
  }
  return { locate, remeasure: () => (rows = undefined) }
}
