import { expect, it } from 'vitest'
import { safeTextStyleValue } from '../src/richtext.js'

it('shares the supported inline CSS contract without permitting injected declarations', () => {
  expect(safeTextStyleValue('fontSize', '.5rem')).toBe('.5rem')
  expect(safeTextStyleValue('fontSize', ' 24px ')).toBe('24px')
  expect(safeTextStyleValue('fontSize', 'calc(12px + 1vw)')).toBeUndefined()
  expect(safeTextStyleValue('fontFamily', 'Arial;position:fixed')).toBeUndefined()
  expect(safeTextStyleValue('color', 'red;background:url(evil)')).toBeUndefined()
  expect(safeTextStyleValue('toString', 'red')).toBeUndefined()
  expect(safeTextStyleValue('fontSize', 24)).toBeUndefined()
})
