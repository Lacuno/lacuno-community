import { expect, it } from 'vitest'
import { insertionIndex, insertionLine, layoutAxis, stableIndex } from '../src/dragTarget.js'

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
})
