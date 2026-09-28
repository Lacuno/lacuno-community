import type { CssValue, Document, FieldDef, Node, NodeId } from '@lacuno/schema'
import { nodeBindings } from '@lacuno/schema'

export function subtreeIds(doc: Document, rootId: NodeId): NodeId[] {
  const out: NodeId[] = []
  const visit = (id: NodeId) => {
    const node = doc.nodes[id]
    if (!node) return
    out.push(id)
    for (const c of node.children) visit(c)
  }
  visit(rootId)
  return out
}

export function isDescendant(doc: Document, ancestorId: NodeId, nodeId: NodeId): boolean {
  let current = doc.nodes[nodeId]?.parent ?? null
  while (current !== null) {
    if (current === ancestorId) return true
    current = doc.nodes[current]?.parent ?? null
  }
  return false
}

export function isRootNode(doc: Document, nodeId: NodeId): boolean {
  return (
    Object.values(doc.pages).some((p) => p.root === nodeId) ||
    Object.values(doc.components).some((c) => c.root === nodeId)
  )
}

export function parentIndex(
  doc: Document,
  nodeId: NodeId,
): { parent: NodeId; index: number } | undefined {
  const parent = doc.nodes[nodeId]?.parent
  if (!parent) return undefined
  const index = doc.nodes[parent]?.children.indexOf(nodeId) ?? -1
  return index >= 0 ? { parent, index } : undefined
}

export function nodesUsingClass(doc: Document, classId: string): NodeId[] {
  return Object.values(doc.nodes)
    .filter((n) => n.classes.includes(classId))
    .map((n) => n.id)
    .sort()
}

export function stylesUsingBreakpoint(doc: Document, breakpointId: string): string[] {
  return Object.entries(doc.styles)
    .filter(([, d]) => d.breakpoint === breakpointId)
    .map(([key]) => key)
    .sort()
}

export function instancesOfComponent(doc: Document, componentId: string): NodeId[] {
  return Object.values(doc.nodes)
    .filter((n) => n.type === 'component' && n.component === componentId)
    .map((n) => n.id)
    .sort()
}

type Refs = { designTokens: Set<string>; assets: Set<string> }

export function cssValueReferences(value: CssValue, into: Refs): void {
  switch (value.type) {
    case 'designToken':
      into.designTokens.add(value.ref)
      return
    case 'image':
      into.assets.add(value.asset)
      return
    case 'list':
      for (const v of value.values) cssValueReferences(v, into)
      return
    case 'fn':
      for (const v of value.args) cssValueReferences(v, into)
      return
    case 'gradient':
      for (const stop of value.stops) cssValueReferences(stop.color, into)
      return
    default:
      return
  }
}

function valueRefs(values: readonly CssValue[]): Refs {
  const refs: Refs = { designTokens: new Set(), assets: new Set() }
  for (const v of values) cssValueReferences(v, refs)
  return refs
}

function nodeRefs(node: Node): Refs {
  const refs: Refs = { designTokens: new Set(), assets: new Set() }
  for (const b of nodeBindings(node))
    if (b.type === 'designToken') refs.designTokens.add(b.designToken)
    else if (b.type === 'asset') refs.assets.add(b.asset)
  return refs
}

/** Where a design token or an asset is used: style values, other design tokens, node bindings. */
export function referencesTo(doc: Document, kind: keyof Refs, id: string): string[] {
  const out: string[] = []
  for (const [key, decl] of Object.entries(doc.styles))
    if (valueRefs([decl.value])[kind].has(id)) out.push(`styles.${key}`)
  for (const token of Object.values(doc.designTokens))
    if (token.id !== id && valueRefs(Object.values(token.values))[kind].has(id))
      out.push(`designTokens.${token.id}`)
  for (const node of Object.values(doc.nodes))
    if (nodeRefs(node)[kind].has(id)) out.push(`nodes.${node.id}`)
  return out.sort()
}

export function referencesToDesignToken(doc: Document, id: string): string[] {
  return referencesTo(doc, 'designTokens', id)
}

export function referencesToAsset(doc: Document, id: string): string[] {
  const out = referencesTo(doc, 'assets', id)
  doc.site.fonts.forEach((f, i) => {
    if (f.asset === id) out.push(`site.fonts.${i}`)
  })
  if (doc.site.favicon === id) out.push('site.favicon')
  for (const page of Object.values(doc.pages))
    if (page.seo?.ogImage === id) out.push(`pages.${page.id}.seo.ogImage`)
  out.push(...entriesWith(doc, (f) => f.type === 'image' || f.type === 'file', id))
  return out.sort()
}

/** The entries (`entries.<collection>.<index>`) whose value of a matching field is or lists `id`. */
function entriesWith(doc: Document, match: (field: FieldDef) => boolean, id: string): string[] {
  const out: string[] = []
  for (const col of Object.values(doc.collections)) {
    const fields = col.fields.filter(match).map((f) => f.id)
    if (!fields.length) continue
    doc.entries[col.id]?.forEach((entry, index) => {
      if (
        fields.some((f) => {
          const value = entry.fields[f]
          return value === id || (Array.isArray(value) && value.includes(id))
        })
      )
        out.push(`entries.${col.id}.${index}`)
    })
  }
  return out
}

/** Where an entry is used: reference fields of other entries and list filters that name it. */
export function referencesToEntry(doc: Document, collection: string, id: string): string[] {
  const out = entriesWith(
    doc,
    (f) => (f.type === 'reference' || f.type === 'multi-reference') && f.reference === collection,
    id,
  )
  for (const node of Object.values(doc.nodes))
    if (
      node.type === 'collection-list' &&
      node.query?.filter?.some(
        (f) => f.value === id || (Array.isArray(f.value) && f.value.includes(id)),
      )
    )
      out.push(`nodes.${node.id}`)
  return out.sort()
}

export function referencesToCollection(doc: Document, id: string): string[] {
  const out: string[] = []
  for (const page of Object.values(doc.pages))
    if (page.collection === id) out.push(`pages.${page.id}`)
  for (const node of Object.values(doc.nodes))
    if (node.type === 'collection-list' && node.collection === id) out.push(`nodes.${node.id}`)
  for (const col of Object.values(doc.collections))
    for (const f of col.fields)
      if (
        (f.type === 'reference' || f.type === 'multi-reference') &&
        f.reference === id &&
        col.id !== id
      )
        out.push(`collections.${col.id}.fields.${f.id}`)
  return out.sort()
}

/** Whether rich text, or any JSON holding it, has a link mark to the page. */
const linksToPage = (value: unknown, id: string): boolean =>
  typeof value === 'object' &&
  value !== null &&
  ((value as { pageId?: unknown }).pageId === id ||
    Object.values(value).some((v) => linksToPage(v, id)))

/**
 * Where a page is used: node bindings and rich-text links in text nodes and entries, so a page
 * with a link pointing at it cannot be deleted.
 */
export function referencesToPage(doc: Document, id: string): string[] {
  const out = Object.values(doc.nodes)
    .filter(
      (n) =>
        nodeBindings(n).some((b) => b.type === 'page' && b.page === id) ||
        (n.type === 'text' && linksToPage(n.text, id)),
    )
    .map((n) => `nodes.${n.id}`)
  for (const [collection, entries] of Object.entries(doc.entries))
    entries.forEach((entry, index) => {
      if (linksToPage(entry.fields, id)) out.push(`entries.${collection}.${index}`)
    })
  return out.sort()
}

export function referencesToField(doc: Document, fieldId: string): string[] {
  const out: string[] = []
  for (const node of Object.values(doc.nodes)) {
    const query = node.type === 'collection-list' ? node.query : undefined
    if (
      nodeBindings(node).some((b) => b.type === 'field' && b.field === fieldId) ||
      query?.filter?.some((f) => f.field === fieldId) ||
      query?.sort?.some((s) => s.field === fieldId)
    )
      out.push(`nodes.${node.id}`)
  }
  return out.sort()
}

export function designTokensUsingMode(doc: Document, modeId: string): string[] {
  return Object.values(doc.designTokens)
    .filter((t) => t.values[modeId] !== undefined)
    .map((t) => t.id)
    .sort()
}
