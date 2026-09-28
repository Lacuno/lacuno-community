import { expect, it } from 'vitest'
import { RichText } from '../src/nodes.js'
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

const p = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const cell = (text: string, type = 'tableCell', attrs?: object) => ({
  type,
  attrs,
  content: [p(text)],
})
const row = (...cells: object[]) => ({ type: 'tableRow', content: cells })
const table = (...rows: object[]) => ({ type: 'table', content: rows })
const problem = (...content: object[]) => {
  const result = RichText.safeParse({ type: 'doc', content })
  return result.success ? undefined : result.error.issues[0]?.message
}

it('accepts tables with an optional header row, marks in cells and spans', () => {
  expect(
    problem(
      p('Before'),
      table(
        row(cell('What', 'tableHeader'), cell('Why', 'tableHeader')),
        row(cell('Email'), {
          type: 'tableCell',
          attrs: { colspan: 1, rowspan: 1, colwidth: null },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Login', marks: [{ type: 'bold' }] }],
            },
          ],
        }),
      ),
    ),
  ).toBeUndefined()
  expect(problem(table(row(cell('a'), cell('b'))))).toBeUndefined()
  expect(
    problem(
      table(
        row(cell('wide', 'tableCell', { colspan: 2 })),
        row(cell('tall', 'tableCell', { rowspan: 2 }), cell('b')),
        row(cell('c')),
      ),
    ),
  ).toBeUndefined()
})

it('refuses malformed tables', () => {
  expect(problem(table())).toBe('a table cannot be empty')
  expect(problem(table(p('loose')))).toBe('a table holds only tableRow')
  expect(problem(table(row(p('loose'))))).toBe('a tableRow holds only tableCell or tableHeader')
  expect(problem(row(cell('a')))).toBe('a tableRow must sit in a table')
  expect(problem({ type: 'blockquote', content: [cell('a')] })).toBe(
    'a tableCell must sit in a table',
  )
  expect(problem(table(row({ type: 'tableCell', content: [] })))).toBe(
    'a tableCell cannot be empty',
  )
  expect(problem(table(row({ type: 'tableCell', content: [table(row(cell('inner')))] })))).toBe(
    'a table cannot sit inside a table',
  )
  expect(problem(table(row(cell('a'), cell('b')), row(cell('c'))))).toBe(
    'every row of a table needs the same number of columns',
  )
  expect(problem(table(row(cell('a', 'tableCell', { rowspan: 2 }))))).toBe(
    'a cell spans past the last row',
  )
  expect(problem(table(row(cell('a', 'tableCell', { colspan: 0 }))))).toBe(
    'colspan must be a whole number of at least 1',
  )
})
