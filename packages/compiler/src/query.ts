import type { CollectionListNode, Entry } from '@miralo/schema'

type Query = CollectionListNode['query']
type Filter = NonNullable<NonNullable<Query>['filter']>[number]

function matches(entry: Entry, f: Filter): boolean {
  const v = entry.fields[f.field]
  switch (f.op) {
    case 'eq':
      return v === f.value
    case 'ne':
      return v !== f.value
    case 'in':
      return Array.isArray(f.value) && f.value.includes(v)
    case 'contains':
      if (Array.isArray(v)) return v.includes(f.value)
      if (typeof v === 'string') return v.includes(String(f.value))
      return false
  }
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (a === undefined || a === null) return b === undefined || b === null ? 0 : 1
  if (b === undefined || b === null) return -1
  const sa = String(a)
  const sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

/** Filter, sort, offset and limit, in that order. Sorting is stable. */
export function applyQuery(entries: Entry[], query: Query): Entry[] {
  let out = entries
  for (const f of query?.filter ?? []) out = out.filter((e) => matches(e, f))
  for (const s of [...(query?.sort ?? [])].reverse()) {
    out = [...out].sort((a, b) => {
      const c = compare(a.fields[s.field], b.fields[s.field])
      return s.direction === 'desc' ? -c : c
    })
  }
  const start = query?.offset ?? 0
  const end = query?.limit !== undefined ? start + query.limit : undefined
  return out.slice(start, end)
}
