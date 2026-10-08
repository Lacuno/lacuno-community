import { fixtureDocument, type Document as SiteDocument, styleKey } from '@lacuno/schema'
import { expect, it } from 'vitest'
import {
  canvasSlots,
  crossAlignment,
  crossBand,
  DWELL,
  ghostRect,
  insertionIndex,
  insertionLine,
  intentOperations,
  layoutAxis,
  pastEnd,
  stableIndex,
} from '../src/dragTarget.js'

const style = {
  display: 'block',
  flexDirection: 'row',
  gridTemplateColumns: 'none',
  gridAutoFlow: 'row',
  direction: 'ltr',
}

it('distinguishes vertical stacks, horizontal rows, and multi-column grids', () => {
  expect(layoutAxis(style)).toEqual({ horizontal: false, reverse: false })
  expect(
    layoutAxis({ ...style, display: 'grid', gridTemplateColumns: '[start] 200px [end]' }),
  ).toEqual({ horizontal: false, reverse: false })
  expect(layoutAxis({ ...style, display: 'grid', gridTemplateColumns: '600px 200px' })).toEqual({
    horizontal: true,
    reverse: false,
  })
  expect(layoutAxis({ ...style, display: 'flex' })).toEqual({ horizontal: true, reverse: false })
  expect(layoutAxis({ ...style, display: 'flex', flexDirection: 'column' })).toEqual({
    horizontal: false,
    reverse: false,
  })
})

it('accounts for reversed flex flow and RTL without reversing vertical stacks', () => {
  expect(layoutAxis({ ...style, display: 'flex', flexDirection: 'row-reverse' })).toEqual({
    horizontal: true,
    reverse: true,
  })
  expect(layoutAxis({ ...style, display: 'flex', direction: 'rtl' })).toEqual({
    horizontal: true,
    reverse: true,
  })
  expect(
    layoutAxis({ ...style, display: 'flex', flexDirection: 'row-reverse', direction: 'rtl' }),
  ).toEqual({ horizontal: true, reverse: false })
  expect(
    layoutAxis({ ...style, display: 'flex', flexDirection: 'column-reverse', direction: 'rtl' }),
  ).toEqual({ horizontal: false, reverse: true })
})

const box = (left: number, top: number, width = 100, height = 50) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
})
const column = { horizontal: false, reverse: false }
const row = { horizontal: true, reverse: false }

it('counts the children before a point along the flow, line by line when rows wrap', () => {
  const stack = [box(0, 0), box(0, 60), box(0, 120)]
  expect(insertionIndex(stack, 50, 10, column)).toBe(0)
  expect(insertionIndex(stack, 50, 40, column)).toBe(1)
  expect(insertionIndex(stack, 50, 150, column)).toBe(3)
  expect(insertionIndex(stack, 50, 40, { horizontal: false, reverse: true })).toBe(2)
  // Two lines of two: the pointer picks the line, then the slot within it.
  const grid = [box(0, 0), box(110, 0), box(0, 60), box(110, 60)]
  expect(insertionIndex(grid, 160, 20, row)).toBe(1)
  expect(insertionIndex(grid, 190, 20, row)).toBe(2)
  expect(insertionIndex(grid, 20, 80, row)).toBe(2)
  expect(insertionIndex(grid, 190, 80, row)).toBe(4)
  expect(insertionIndex(grid, 20, 20, { horizontal: true, reverse: true })).toBe(2)
  expect(insertionIndex([], 0, 0, row)).toBe(0)
  // A child aligned lower across the flow still continues the line it starts past.
  const aligned = [box(0, 0), box(110, 0), box(220, 80)]
  expect(insertionIndex(aligned, 150, 100, row)).toBe(1)
  expect(insertionIndex(aligned, 200, 100, row)).toBe(2)
  expect(insertionIndex(aligned, 300, 20, row)).toBe(3)
  expect(
    insertionIndex([box(220, 0), box(110, 0), box(0, 80)], 60, 100, {
      horizontal: true,
      reverse: true,
    }),
  ).toBe(2)
})

it('keeps the previous slot near a boundary so the line does not flicker', () => {
  const stack = [box(0, 0), box(0, 60)]
  expect(stableIndex(stack, 0, 27, column, 0)).toBe(0)
  expect(stableIndex(stack, 0, 27, column, 1)).toBe(1)
  expect(stableIndex(stack, 0, 40, column, 0)).toBe(1)
})

it('draws the line between neighbours, across the flow, or beside the nearer wrapped one', () => {
  const stack = [box(0, 0), box(0, 60)]
  const slot = (boxes: ReturnType<typeof box>[], at: number, flow = column) => ({
    parent: 'p',
    index: at,
    slot: at,
    flow,
    boxes,
  })
  expect(insertionLine(slot(stack, 1), 0, 2)).toEqual({ left: 0, top: 54, width: 100, height: 2 })
  expect(insertionLine(slot(stack, 0), 0, 2)).toEqual({ left: 0, top: -1, width: 100, height: 2 })
  expect(insertionLine(slot([], 0), 0, 2)).toBeUndefined()
  const grid = [box(0, 0), box(110, 0), box(0, 60), box(110, 60)]
  expect(insertionLine(slot(grid, 1, row), 20, 2)).toEqual({
    left: 104,
    top: 0,
    width: 2,
    height: 50,
  })
  // Slot 2 ends the first line and starts the second: the line follows the pointer's line.
  expect(insertionLine(slot(grid, 2, row), 20, 2)?.left).toBe(209)
  expect(insertionLine(slot(grid, 2, row), 80, 2)?.left).toBe(-1)
  // Between neighbours aligned differently across the flow, the line still spans both.
  expect(insertionLine(slot([box(0, 0), box(110, 80)], 1, row), 20, 2)).toEqual({
    left: 104,
    top: 0,
    width: 2,
    height: 130,
  })
})

const content = box(0, 0, 300, 120)

it('offers a band by thirds across the flow and end past the last child by more than the gap', () => {
  expect(crossBand(content, 150, 10, row)).toBe('start')
  expect(crossBand(content, 150, 60, row)).toBe('center')
  expect(crossBand(content, 150, 110, row)).toBe('end')
  expect(crossBand(content, 50, 60, column)).toBe('start')
  expect(crossBand(content, 250, 60, column)).toBe('end')
  const tiles = [box(0, 0), box(116, 0)]
  expect(pastEnd(tiles, 2, 240, 20, row, 16)).toBe(true)
  expect(pastEnd(tiles, 2, 230, 20, row, 16)).toBe(false)
  expect(pastEnd(tiles, 1, 240, 20, row, 16)).toBe(false)
  expect(pastEnd(tiles, 2, -20, 20, { horizontal: true, reverse: true }, 16)).toBe(true)
  expect(pastEnd([box(0, 0), box(0, 60)], 2, 50, 130, column, 16)).toBe(true)
  expect(pastEnd([], 0, 50, 130, column, 16)).toBe(false)
})

it('reads what a flex item is aligned to, through auto to the parent', () => {
  expect(crossAlignment('auto', 'normal')).toBe('stretch')
  expect(crossAlignment('auto', 'center')).toBe('center')
  expect(crossAlignment('flex-start', 'center')).toBe('start')
  expect(crossAlignment('self-end', 'normal')).toBe('end')
  expect(crossAlignment('stretch', 'flex-end')).toBe('stretch')
  expect(crossAlignment('baseline', 'normal')).toBeUndefined()
})

it('places the ghost on the line at the band, at the far end, or beside a sibling', () => {
  const size = { width: 100, height: 50 }
  const line = { left: 109, top: 0, width: 2, height: 50 }
  expect(ghostRect({ flow: row, content }, line, size)).toEqual({
    left: 60,
    top: 0,
    width: 100,
    height: 50,
  })
  expect(ghostRect({ flow: row, content, band: 'center' }, line, size)).toEqual({
    left: 60,
    top: 35,
    width: 100,
    height: 50,
  })
  expect(ghostRect({ flow: row, content, band: 'end', end: true }, line, size)).toEqual({
    left: 200,
    top: 70,
    width: 100,
    height: 50,
  })
  expect(
    ghostRect({ flow: { horizontal: true, reverse: true }, content, end: true }, line, size)?.left,
  ).toBe(0)
  const across = { left: 0, top: 54, width: 300, height: 2 }
  expect(ghostRect({ flow: column, content, band: 'end' }, across, size)).toEqual({
    left: 200,
    top: 30,
    width: 100,
    height: 50,
  })
  expect(ghostRect({ flow: column, content }, undefined, size)).toBeUndefined()
  const sibling = box(40, 60, 200, 30)
  expect(
    ghostRect({ flow: column, content }, undefined, size, { box: sibling, first: true }),
  ).toEqual({ left: -60, top: 60, width: 100, height: 30 })
  expect(
    ghostRect({ flow: column, content }, undefined, size, { box: sibling, first: false })?.left,
  ).toBe(240)
})

it('writes the band only when it changes the alignment, and auto margins for end, as one list', () => {
  const doc = fixtureDocument()
  const node = doc.nodes['n-hero-title']!
  const ops = (slot: Parameters<typeof intentOperations>[2], breakpoint = 'base') =>
    intentOperations(doc, node, slot, breakpoint, 'none').map((operation) =>
      operation.type === 'style.set'
        ? [operation.property, operation.value.type === 'keyword' && operation.value.value]
        : operation.type,
    )
  expect(ops({ flow: row, band: 'center', align: 'center' })).toEqual([])
  expect(ops({ flow: row })).toEqual([])
  expect(ops({ flow: row, band: 'center', align: 'stretch' })).toEqual([['align-self', 'center']])
  expect(ops({ flow: row, band: 'end', align: 'start', end: true })).toEqual([
    ['margin-left', 'auto'],
    ['align-self', 'flex-end'],
  ])
  expect(ops({ flow: column, end: true }, 'tablet')).toEqual([['margin-top', 'auto']])
  expect(
    intentOperations(doc, node, { flow: column, end: true }, 'tablet', 'hover')[0],
  ).toMatchObject({ class: 'l-hero-title', breakpoint: 'tablet', state: 'hover' })
  // Dropped elsewhere, a pushed node loses its auto margin at the edited breakpoint and state.
  const pushed = structuredClone(doc)
  for (const operation of intentOperations(doc, node, { flow: row, end: true }, 'base', 'none'))
    if (operation.type === 'style.set') pushed.styles[styleKey(operation)] = operation
  expect(intentOperations(pushed, node, { flow: column }, 'base', 'none')).toEqual([
    {
      type: 'style.clear',
      class: 'l-hero-title',
      breakpoint: 'base',
      state: 'none',
      property: 'margin-left',
    },
  ])
  expect(intentOperations(pushed, node, { flow: column }, 'tablet', 'none')).toEqual([])
  // A preset dropped with intent styles its own class, minted earlier in the same batch.
  const preset = { id: 'n-new', classes: ['c-minted'] }
  expect(
    intentOperations(doc, preset, { flow: row, band: 'end', align: 'stretch' }, 'base', 'none'),
  ).toEqual([
    {
      type: 'style.set',
      class: 'c-minted',
      breakpoint: 'base',
      state: 'none',
      property: 'align-self',
      value: { type: 'keyword', value: 'flex-end' },
    },
  ])
})

/**
 * A rendered page for canvasSlots: plain blocks at the given boxes, listed outer to inner, so the
 * last box under a point is the element hit there.
 */
function surface(doc: SiteDocument, boxes: Record<string, ReturnType<typeof box>>) {
  // Every other computed value reads as 0: no border, padding or gap, so a content box is its box.
  const computed = new Proxy(style as Record<string, string>, {
    get: (values, key) => values[key as string] ?? '0',
  })
  const elements = new Map<string, object>()
  for (const [id, rect] of Object.entries(boxes))
    elements.set(id, {
      dataset: { lacunoNode: id },
      get parentElement() {
        return elements.get(doc.nodes[id]!.parent ?? '') ?? null
      },
      closest: () => elements.get(id),
      getClientRects: () => [rect],
      getBoundingClientRect: () => rect,
    })
  const under = (x: number, y: number) =>
    Object.entries(boxes).findLast(
      ([, b]) => x >= b.left && x < b.right && y >= b.top && y < b.bottom,
    )?.[0]
  return {
    defaultView: { getComputedStyle: () => computed },
    querySelectorAll: () => elements.values(),
    elementFromPoint: (x: number, y: number) => elements.get(under(x, y) ?? '') ?? null,
  } as unknown as Document
}

it('offers a Row with a sibling only once the pointer has rested on its side', () => {
  const doc = fixtureDocument()
  // The hero's inner Stack: a heading, an image and a button, each on its own line.
  const page = surface(doc, {
    'n-home': box(0, 0, 1000, 1000),
    'n-hero': box(0, 0, 1000, 600),
    'n-hero-inner': box(100, 100, 800, 400),
    'n-hero-title': box(100, 100, 800, 100),
    'n-hero-image': box(100, 220, 800, 100),
    'n-hero-cta': box(100, 340, 200, 60),
  })
  const { locate } = canvasSlots(page, doc, 'n-home', { id: 'n-hero-cta' })
  // Passing through the heading's left quarter: before it, as anywhere on its upper half.
  expect(locate(150, 150, 0)).toMatchObject({ parent: 'n-hero-inner', index: 0 })
  expect(locate(150, 150, DWELL - 1)?.wrap).toBeUndefined()
  // Resting there: a Row with the heading, the button first.
  expect(locate(150, 150, DWELL)).toMatchObject({ index: 0, wrap: 'n-hero-title', first: true })
  // Moving on, even by 9 px, starts over; rested on the right quarter, the button goes second.
  expect(locate(159, 150, DWELL + 1)?.wrap).toBeUndefined()
  expect(locate(850, 150, DWELL + 2)?.wrap).toBeUndefined()
  expect(locate(850, 150, 2 * DWELL + 2)).toMatchObject({ wrap: 'n-hero-title', first: false })
})
