import type { Document } from '@lacuno/schema'

/** The id-keyed maps, sorted so insertion order never shows up in a diff. */
const SORTED_MAPS = [
  'pages',
  'folders',
  'nodes',
  'classes',
  'styles',
  'breakpoints',
  'designTokens',
  'components',
  'collections',
  'entries',
  'assets',
] as const

/** Every top-level key in schema order, so serializing needs no reparse. */
const KEYS = ['version', 'revision', 'site', ...SORTED_MAPS, 'redirects'] as const
const sorted = new Set<string>(SORTED_MAPS)

function sortKeys(map: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(map)
      .sort()
      .map((k) => [k, map[k]]),
  )
}

/**
 * Deterministic JSON: top-level keys in schema order, id-keyed maps sorted, two-space indent,
 * trailing newline. A git diff after a batch shows only the change.
 */
export function serializeDocument(doc: Document): string {
  const out: Record<string, unknown> = {}
  for (const key of KEYS)
    out[key] = sorted.has(key) ? sortKeys(doc[key] as Record<string, unknown>) : doc[key]
  return `${JSON.stringify(out, null, 2)}\n`
}
