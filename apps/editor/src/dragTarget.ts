import type { Operation } from '@lacuno/document'
import { isDescendant } from '@lacuno/document/references'
import type { CssValue, Node, Document as SiteDocument, State } from '@lacuno/schema'
import { formattingOperations, localValue } from './formatting.js'
import { type DragItem, dropTarget, wrapTarget } from './structure.js'

export type Flow = { horizontal: boolean; reverse: boolean }
type Box = Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>
type Rect = { left: number; top: number; width: number; height: number }
/** A third of the parent's content box across the flow. */
export type Band = 'start' | 'center' | 'end'

/**
 * A drop between the parent's children: `slot` counts the laid-out children before it. In a flex
 * parent the pointer's `band` across the flow, offered when the item has room there, becomes its
 * alignment, and `end` pushes it to the far end. On a sibling's outer side in a vertical flow the
 * drop instead makes a Row of the two, at the sibling's place, the item `first` or second.
 */
export type DropSlot = {
  parent: string
  index: number
  slot: number
  flow: Flow
  boxes: Box[]
  content: Box
  /** The parent's gap along the flow. */
  gap: number
  band?: Band
  /** What the item is aligned to across the flow now, so the band writes only a change. */
  align?: Band | 'stretch' | undefined
  end?: boolean
  wrap?: string
  first?: boolean
}

/** How long the pointer rests on a sibling before a drop goes into it instead of beside it. */
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

/** The third of the parent's content box the point is in across the flow. */
export function crossBand(content: Box, x: number, y: number, { horizontal }: Flow): Band {
  const [start, finish, at] = horizontal
    ? [content.top, content.bottom, y]
    : [content.left, content.right, x]
  const fraction = (at - start) / (finish - start)
  return fraction < 1 / 3 ? 'start' : fraction < 2 / 3 ? 'center' : 'end'
}

/** Whether the point is past the last child's trailing edge along the flow by more than the gap. */
export function pastEnd(
  boxes: Box[],
  slot: number,
  x: number,
  y: number,
  { horizontal, reverse }: Flow,
  gap: number,
) {
  const last = boxes.at(-1)
  if (!last || slot < boxes.length) return false
  const beyond = horizontal
    ? reverse
      ? last.left - x
      : x - last.right
    : reverse
      ? last.top - y
      : y - last.bottom
  return beyond > gap
}

/** What a flex item is aligned to across the flow: its own align-self, or the parent's for auto. */
export function crossAlignment(self: string, items: string): Band | 'stretch' | undefined {
  const value = self === 'auto' ? items : self
  if (value === 'normal' || value === 'stretch') return 'stretch'
  if (value.endsWith('start')) return 'start'
  if (value.endsWith('end')) return 'end'
  if (value === 'center') return 'center'
}

/**
 * Where the dragged box would land: centred on the line along the flow, or at the far end of the
 * content box for `end`, and at the band across it; beside the sibling it would share a Row with.
 */
export function ghostRect(
  { flow, content, band, end }: Pick<DropSlot, 'flow' | 'content' | 'band' | 'end'>,
  line: Rect | undefined,
  { width, height }: { width: number; height: number },
  beside?: { box: Box; first: boolean },
): Rect | undefined {
  if (beside)
    return {
      left: beside.first ? beside.box.left - width : beside.box.right,
      top: beside.box.top,
      width,
      height: beside.box.bottom - beside.box.top,
    }
  if (!line) return
  const along = (start: number, finish: number, at: number, length: number) =>
    end ? (flow.reverse ? start : finish - length) : at - length / 2
  const across = (start: number, finish: number, length: number) =>
    band === 'end' ? finish - length : band === 'center' ? (start + finish - length) / 2 : start
  return flow.horizontal
    ? {
        left: along(content.left, content.right, line.left + line.width / 2, width),
        top: across(content.top, content.bottom, height),
        width,
        height,
      }
    : {
        left: across(content.left, content.right, width),
        top: along(content.top, content.bottom, line.top + line.height / 2, height),
        width,
        height,
      }
}

const auto: CssValue = { type: 'keyword', value: 'auto' }

/**
 * The styles a drop writes on the dropped node, after the structure operations of the same batch:
 * the band's alignment when it changes, an auto margin for `end`, and otherwise the end of an auto
 * margin the node carries.
 */
export function intentOperations(
  doc: SiteDocument,
  node: Pick<Node, 'id' | 'classes'>,
  { flow, band, align, end }: Pick<DropSlot, 'flow' | 'band' | 'align' | 'end'>,
  breakpoint: string,
  state: State,
): Operation[] {
  const changes: Record<string, CssValue | null> = {}
  for (const side of ['margin-left', 'margin-top']) {
    const value = localValue(doc, node as Node, side, breakpoint, state)
    if (value && 'value' in value && value.value === 'auto') changes[side] = null
  }
  if (end) changes[flow.horizontal ? 'margin-left' : 'margin-top'] = auto
  if (band && band !== align)
    changes['align-self'] = { type: 'keyword', value: band === 'center' ? band : `flex-${band}` }
  if (!Object.keys(changes).length) return []
  // A preset's local class was minted earlier in this batch, so the formatting helper cannot see it.
  const minted = node.classes.find((id) => !doc.classes[id])
  if (!minted) return formattingOperations(doc, node as Node, changes, undefined, breakpoint, state)
  return Object.entries(changes).flatMap(([property, value]) =>
    value
      ? [{ type: 'style.set' as const, class: minted, breakpoint, state, property, value }]
      : [],
  )
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
 * stays among its siblings until the pointer rests on one of them for DWELL ms.
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
  type Layout = { flow: Flow; content: Box; gap: number; flex: boolean; items: string }
  const layouts = new Map<string, Layout>()
  const layout = (id: string) => {
    if (!layouts.has(id)) {
      const element = elements.get(id)
      const style = element && view.getComputedStyle(element)
      const rect = box(id) ?? { left: 0, top: 0, right: 0, bottom: 0 }
      const inset = (side: 'Left' | 'Top' | 'Right' | 'Bottom') =>
        style
          ? Number.parseFloat(style[`border${side}Width`]) +
            Number.parseFloat(style[`padding${side}`])
          : 0
      const flow = style ? layoutAxis(style) : { horizontal: false, reverse: false }
      layouts.set(id, {
        flow,
        content: {
          left: rect.left + inset('Left'),
          top: rect.top + inset('Top'),
          right: rect.right - inset('Right'),
          bottom: rect.bottom - inset('Bottom'),
        },
        gap: (style && Number.parseFloat(flow.horizontal ? style.columnGap : style.rowGap)) || 0,
        flex: !!style?.display.includes('flex'),
        items: style?.alignItems ?? 'normal',
      })
    }
    return layouts.get(id)!
  }
  const flow = (id: string) => layout(id).flow
  const dragged = 'id' in item ? item.id : undefined
  const home = dragged ? doc.nodes[dragged]?.parent : undefined
  const contains = (rect: Box, x: number, y: number) =>
    x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
  let previous: DropSlot | undefined
  let rest = { id: '', x: 0, y: 0, since: 0 }
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
    // Resting still on a sibling's inside for DWELL ms drops into it; passing over it reorders.
    if (
      home &&
      parent !== home &&
      isDescendant(doc, home, parent) &&
      doc.nodes[parent]!.children.length
    ) {
      if (rest.id !== parent || Math.hypot(x - rest.x, y - rest.y) > 8)
        rest = { id: parent, x, y, since: now }
      if (now - rest.since < DWELL) parent = home
    } else rest = { id: '', x, y, since: now }
    const children = doc.nodes[parent]!.children
    const laidOut = children.filter((id) => box(id))
    const { flow: flowOf, content, gap, flex, items } = layout(parent)
    const rects = laidOut.map((id) => box(id)!)
    const common = { parent, flow: flowOf, boxes: rects, content, gap }
    // On the outer quarter of a sibling's side, where a vertical flow has no before or after, the
    // two become a Row; in a horizontal flow the sides already mean before and after.
    if (!flowOf.horizontal) {
      const over = laidOut.find((id) => id !== dragged && contains(box(id)!, x, y))
      const rect = over && box(over)!
      const first = rect ? x < rect.left + (rect.right - rect.left) / 4 : false
      const last = rect ? x > rect.right - (rect.right - rect.left) / 4 : false
      if (over && (first || last) && typeof wrapTarget(doc, over, 'row') !== 'string') {
        previous = {
          ...common,
          slot: laidOut.indexOf(over),
          index: children.indexOf(over),
          wrap: over,
          first,
        }
        return previous
      }
    }
    const slot = stableIndex(
      rects,
      x,
      y,
      flowOf,
      previous?.parent === parent ? previous.slot : undefined,
    )
    // A band only where the item has room across the flow; a stretched child just reorders.
    const own = dragged ? box(dragged) : undefined
    const room = own
      ? flowOf.horizontal
        ? own.height < content.bottom - content.top - 8
        : own.width < content.right - content.left - 8
      : true
    const self = dragged && elements.get(dragged)
    previous = {
      ...common,
      slot,
      index: slot < laidOut.length ? children.indexOf(laidOut[slot]!) : children.length,
      ...(flex && room
        ? {
            band: crossBand(content, x, y, flowOf),
            align: crossAlignment(self ? view.getComputedStyle(self).alignSelf : 'auto', items),
          }
        : {}),
      ...(flex && pastEnd(rects, slot, x, y, flowOf, gap) ? { end: true } : {}),
    }
    return previous
  }
  return {
    locate,
    box: (id: string) => box(id),
    /** Measure again, after the canvas scrolled or resized. */
    remeasure: () => boxes.clear(),
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
