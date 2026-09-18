import { expect, it } from 'vitest'
import { defaultShadow, readShadow, readTilt, writeShadow, writeTilt } from '../src/effects.js'

it('round-trips tilt and leaves custom transforms intact', () => {
  expect(readTilt(writeTilt({ x: 12, y: -8 }))).toEqual({ x: 12, y: -8 })
  expect(readTilt('none')).toEqual({ x: 0, y: 0 })
  expect(readTilt('translateX(10px) rotate(30deg)')).toBeUndefined()
  expect(readTilt('matrix(1, 0, 0, 1, 10, 0)')).toBeUndefined()
})
it('round-trips single shadows without breaking color functions or multiple shadows', () => {
  const shadow = { ...defaultShadow, color: 'rgba(10, 20, 30, 0.4)', inset: true, spread: -2 }
  expect(readShadow(writeShadow(shadow))).toEqual(shadow)
  expect(readShadow('0px 1px 2px 0px red, 0px 2px 4px 0px blue')).toBeUndefined()
  expect(readShadow('none')).toEqual(defaultShadow)
})
