import { expect, it } from 'vitest'
import { layoutAxis } from '../src/dragTarget.js'

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
