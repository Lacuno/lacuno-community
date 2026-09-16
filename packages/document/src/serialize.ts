import { type Document, Document as DocumentSchema } from '@freeflow/schema'

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

function sortKeys<T>(map: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.keys(map)
      .sort()
      .map((k) => [k, map[k] as T]),
  )
}

/**
 * Deterministic JSON: top-level keys in schema order (Zod emits them that way), id-keyed maps
 * sorted, two-space indent, trailing newline. A git diff after a batch shows only the change.
 */
export function serializeDocument(doc: Document): string {
  const parsed = DocumentSchema.parse(doc) as unknown as Record<string, unknown>
  for (const key of SORTED_MAPS) parsed[key] = sortKeys(parsed[key] as Record<string, unknown>)
  return `${JSON.stringify(parsed, null, 2)}\n`
}
