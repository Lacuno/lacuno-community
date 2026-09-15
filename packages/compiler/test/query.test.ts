import type { Entry } from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import { applyQuery } from '../src/query.js'

const entries: Entry[] = [
  { id: 'a', fields: { title: 'Alpha', n: 3, tags: ['x', 'y'], date: '2026-01-03' } },
  { id: 'b', fields: { title: 'Beta', n: 1, tags: ['y'], date: '2026-01-01' } },
  { id: 'c', fields: { title: 'Gamma', n: 2, tags: [], date: '2026-01-02' } },
]
const ids = (list: Entry[]) => list.map((e) => e.id)

describe('applyQuery', () => {
  it('returns entries unchanged without a query', () => {
    expect(ids(applyQuery(entries, undefined))).toEqual(['a', 'b', 'c'])
  })
  it('filters with eq, ne, in and contains', () => {
    expect(ids(applyQuery(entries, { filter: [{ field: 'n', op: 'eq', value: 2 }] }))).toEqual([
      'c',
    ])
    expect(ids(applyQuery(entries, { filter: [{ field: 'n', op: 'ne', value: 2 }] }))).toEqual([
      'a',
      'b',
    ])
    expect(ids(applyQuery(entries, { filter: [{ field: 'n', op: 'in', value: [1, 3] }] }))).toEqual(
      ['a', 'b'],
    )
    expect(
      ids(applyQuery(entries, { filter: [{ field: 'tags', op: 'contains', value: 'x' }] })),
    ).toEqual(['a'])
    expect(
      ids(applyQuery(entries, { filter: [{ field: 'title', op: 'contains', value: 'mm' }] })),
    ).toEqual(['c'])
  })
  it('sorts by strings, numbers and dates, then paginates', () => {
    expect(ids(applyQuery(entries, { sort: [{ field: 'n', direction: 'asc' }] }))).toEqual([
      'b',
      'c',
      'a',
    ])
    expect(ids(applyQuery(entries, { sort: [{ field: 'date', direction: 'desc' }] }))).toEqual([
      'a',
      'c',
      'b',
    ])
    expect(
      ids(
        applyQuery(entries, {
          sort: [{ field: 'title', direction: 'desc' }],
          offset: 1,
          limit: 1,
        }),
      ),
    ).toEqual(['b'])
  })
})
