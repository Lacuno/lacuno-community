import { publicAssetPath } from '@lacuno/compiler'
import { contextFromDocument, serializeValue } from '@lacuno/css'
import type { Document, NodeId, RichText } from '@lacuno/schema'
import { plainText } from './preview.js'

/** One line of a diff. A change names the field that changed, with its value before and after. */
export type Change = {
  change: 'added' | 'removed' | 'changed'
  id: string
  label?: string
  /** For nodes: the page path or component the node belongs to. */
  where?: string
  field?: string
  before?: string
  after?: string
}

export type DocumentDiff = Record<string, Change[]>

/** Raw field values, compared as JSON and turned into display strings only for output. */
type Fields = Record<string, unknown>
type Item = { label?: string | undefined; where?: string; fields: Fields; value?: string }

function show(v: unknown): string {
  if (typeof v === 'string') return v
  if ((v as RichText | null)?.type === 'doc') return `"${plainText(v)}"`
  return JSON.stringify(v)
}

/** Nested plain objects become dotted fields; arrays and typed values (a `type` key) are leaves. */
function flat(value: object, prefix = '', out: Fields = {}): Fields {
  for (const [k, v] of Object.entries(value)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v) && !('type' in v)) flat(v, key, out)
    else if (v !== undefined) out[key] = v
  }
  return out
}

function items<T extends object>(
  record: Record<string, T>,
  label: (item: T) => string | undefined,
): Record<string, Item> {
  return Object.fromEntries(
    Object.entries(record).map(([id, item]) => [id, { label: label(item), fields: flat(item) }]),
  )
}

function where(d: Document, id: NodeId): string {
  let root = id
  while (d.nodes[root]?.parent) root = d.nodes[root]!.parent!
  const page = Object.values(d.pages).find((p) => p.root === root)
  if (page) return page.path
  const component = Object.values(d.components).find((c) => c.root === root)
  return component ? `component ${component.name}` : 'no page'
}

/**
 * A node's fields, its parent, and its position among the siblings that share that parent in
 * both documents, so inserting or removing a sibling does not read as a move.
 */
function nodes(d: Document, other: Document): Record<string, Item> {
  return Object.fromEntries(
    Object.values(d.nodes).map((node) => {
      const { id, children: _c, ...rest } = node
      const fields = flat(rest)
      if (node.parent) {
        const stable = d.nodes[node.parent]!.children.filter(
          (s) => other.nodes[s]?.parent === node.parent,
        )
        if (stable.includes(id)) fields.position = String(stable.indexOf(id))
      }
      const label = node.meta?.label ?? ('tag' in node ? node.tag : node.type)
      return [id, { label, where: where(d, id), fields }]
    }),
  )
}

const SECTIONS: [string, string, (d: Document, other: Document) => Record<string, Item>][] = [
  ['site', 'Site', (d) => ({ site: { fields: flat({ ...d.site, fonts: undefined }) } })],
  ['pages', 'Pages', (d) => items(d.pages, (p) => p.name)],
  ['folders', 'Folders', (d) => items(d.folders, (f) => f.name)],
  ['nodes', 'Nodes', nodes],
  [
    'styles',
    'Styles',
    (d) => {
      const ctx = contextFromDocument(d, publicAssetPath)
      return Object.fromEntries(
        Object.values(d.styles).map((s) => {
          const state = s.state === 'none' ? '' : `:${s.state}`
          const value = serializeValue(s.value, ctx)
          const fields: Fields = s.important ? { value, important: 'true' } : { value }
          return [`.${s.class} ${s.breakpoint}${state} ${s.property}`, { fields, value }]
        }),
      )
    },
  ],
  [
    'designTokens',
    'Design tokens',
    (d) => {
      const ctx = contextFromDocument(d, publicAssetPath)
      return Object.fromEntries(
        Object.values(d.designTokens).map((t) => {
          const values = Object.entries(t.values).map(([mode, v]) => [
            `values.${mode}`,
            serializeValue(v, ctx),
          ])
          return [t.id, { label: t.name, fields: { ...flat(t), ...Object.fromEntries(values) } }]
        }),
      )
    },
  ],
  ['classes', 'Classes', (d) => items(d.classes, (c) => c.name)],
  ['breakpoints', 'Breakpoints', (d) => items(d.breakpoints, (b) => b.label)],
  ['components', 'Components', (d) => items(d.components, (c) => c.name)],
  ['collections', 'Collections', (d) => items(d.collections, (c) => c.name)],
  [
    'entries',
    'Entries',
    (d) =>
      Object.fromEntries(
        Object.entries(d.entries).flatMap(([collection, entries]) =>
          entries.map((e) => [`${collection}/${e.id}`, { fields: flat(e) }]),
        ),
      ),
  ],
  ['assets', 'Assets', (d) => items(d.assets, (a) => a.name)],
  [
    'fonts',
    'Fonts',
    (d) =>
      Object.fromEntries(
        d.site.fonts.map((f) => [
          `${f.family} ${f.weightRange?.join('-') ?? f.weight ?? 400} ${f.style ?? 'normal'}`,
          { fields: flat(f) },
        ]),
      ),
  ],
  [
    'redirects',
    'Redirects',
    (d) => Object.fromEntries(d.redirects.map((r) => [r.from, { fields: flat(r) }])),
  ],
]

function compare(before: Record<string, Item>, after: Record<string, Item>): Change[] {
  const out: Change[] = []
  const keys = (a: object, b: object) => [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
  for (const id of keys(before, after)) {
    const b = before[id]
    const a = after[id]
    const item = (a ?? b) as Item
    const head: Change = { change: !b ? 'added' : !a ? 'removed' : 'changed', id }
    if (item.label) head.label = item.label
    if (item.where) head.where = item.where
    if (!b || !a) {
      out.push(item.value === undefined ? head : { ...head, [a ? 'after' : 'before']: item.value })
      continue
    }
    for (const field of keys(b.fields, a.fields)) {
      const [x, y] = [b.fields[field], a.fields[field]]
      if (JSON.stringify(x) === JSON.stringify(y)) continue
      const change: Change = { ...head, field }
      if (x !== undefined) change.before = show(x)
      if (y !== undefined) change.after = show(y)
      out.push(change)
    }
  }
  return out
}

/** What changed from `before` to `after`, by section in a fixed order; empty sections omitted. */
export function diffDocuments(before: Document, after: Document): DocumentDiff {
  const diff: DocumentDiff = {}
  for (const [section, , describe] of SECTIONS) {
    const changes = compare(describe(before, after), describe(after, before))
    if (changes.length) diff[section] = changes
  }
  return diff
}

const SYMBOL = { added: '+', removed: '-', changed: '~' }

export function formatDiff(diff: DocumentDiff): string {
  const blocks = SECTIONS.filter(([section]) => diff[section]).map(([section, title]) => {
    const lines = (diff[section] as Change[]).map((c) => {
      const head = [SYMBOL[c.change], c.id, c.label, c.where && `on ${c.where}`]
        .filter(Boolean)
        .join(' ')
      if (c.field === undefined) {
        const value = c.after ?? c.before
        return value === undefined ? head : `${head}: ${value}`
      }
      return `${head} ${c.field}: ${c.before ?? '(none)'} → ${c.after ?? '(none)'}`
    })
    return [title, ...lines].join('\n')
  })
  return blocks.length ? blocks.join('\n\n') : 'No changes.'
}
