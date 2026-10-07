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

type Uses = Map<string, string[]>

/** Notes `ref` as a use of each of `ids`, except of `self`. */
function addUses(uses: Uses, ids: Iterable<string>, ref: string, self?: string): void {
  for (const id of ids) {
    if (id === self) continue
    const list = uses.get(id)
    if (list) list.push(ref)
    else uses.set(id, [ref])
  }
}

/** Every design token's or asset's uses at once: style values, other design tokens, node bindings. */
function referencesToEach(doc: Document, kind: keyof Refs): Uses {
  const uses: Uses = new Map()
  for (const [key, decl] of Object.entries(doc.styles))
    addUses(uses, valueRefs([decl.value])[kind], `styles.${key}`)
  for (const token of Object.values(doc.designTokens))
    addUses(
      uses,
      valueRefs(Object.values(token.values))[kind],
      `designTokens.${token.id}`,
      token.id,
    )
  for (const node of Object.values(doc.nodes))
    addUses(uses, nodeRefs(node)[kind], `nodes.${node.id}`)
  return uses
}

/** Where a design token or an asset is used: style values, other design tokens, node bindings. */
export function referencesTo(doc: Document, kind: keyof Refs, id: string): string[] {
  return (referencesToEach(doc, kind).get(id) ?? []).sort()
}

export function referencesToDesignToken(doc: Document, id: string): string[] {
  return referencesTo(doc, 'designTokens', id)
}

/**
 * Every asset's uses at once, sorted, which document.read lists for each asset; one walk, where a
 * lookup per asset would walk the document once per asset.
 */
export function referencesToAssets(doc: Document): Uses {
  const uses = referencesToEach(doc, 'assets')
  doc.site.fonts.forEach((f, i) => {
    if (f.asset) addUses(uses, [f.asset], `site.fonts.${i}`)
  })
  if (doc.site.favicon) addUses(uses, [doc.site.favicon], 'site.favicon')
  for (const page of Object.values(doc.pages))
    if (page.seo?.ogImage) addUses(uses, [page.seo.ogImage], `pages.${page.id}.seo.ogImage`)
  entriesWith(doc, (f) => f.type === 'image' || f.type === 'file', uses)
  for (const refs of uses.values()) refs.sort()
  return uses
}

export function referencesToAsset(doc: Document, id: string): string[] {
  return referencesToAssets(doc).get(id) ?? []
}

/** Notes each entry (`entries.<collection>.<index>`) as a use of the ids its matching fields hold or list. */
function entriesWith(doc: Document, match: (field: FieldDef) => boolean, into: Uses): void {
  for (const col of Object.values(doc.collections)) {
    const fields = col.fields.filter(match).map((f) => f.id)
    if (!fields.length) continue
    doc.entries[col.id]?.forEach((entry, index) => {
      const ids = fields
        .flatMap((f) => {
          const value = entry.fields[f]
          return Array.isArray(value) ? value : [value]
        })
        .filter((value): value is string => typeof value === 'string')
      addUses(into, new Set(ids), `entries.${col.id}.${index}`)
    })
  }
}

/** The nodes and pages that read each entry directly, by entry id: bindings and `seo.entry`. */
function readersOfEntries(doc: Document): Uses {
  const readers: Uses = new Map()
  for (const node of Object.values(doc.nodes)) {
    const entries = nodeBindings(node).flatMap((b) =>
      b.type === 'field' && b.entry ? [b.entry] : [],
    )
    addUses(readers, new Set(entries), `nodes.${node.id}`)
  }
  for (const page of Object.values(doc.pages))
    if (page.seo?.entry) addUses(readers, [page.seo.entry], `pages.${page.id}`)
  return readers
}

/**
 * Where an entry is used: reference fields of other entries, list filters that name it, and
 * bindings and pages that read it.
 */
export function referencesToEntry(doc: Document, collection: string, id: string): string[] {
  const uses: Uses = new Map()
  entriesWith(
    doc,
    (f) => (f.type === 'reference' || f.type === 'multi-reference') && f.reference === collection,
    uses,
  )
  const out = uses.get(id) ?? []
  for (const node of Object.values(doc.nodes))
    if (
      node.type === 'collection-list' &&
      node.query?.filter?.some(
        (f) => f.value === id || (Array.isArray(f.value) && f.value.includes(id)),
      )
    )
      out.push(`nodes.${node.id}`)
  out.push(...(readersOfEntries(doc).get(id) ?? []))
  return [...new Set(out)].sort()
}

/** Every collection's uses at once, sorted, which document.read lists for each collection. */
export function referencesToCollections(doc: Document): Uses {
  const uses: Uses = new Map()
  for (const page of Object.values(doc.pages))
    if (page.collection) addUses(uses, [page.collection], `pages.${page.id}`)
  for (const node of Object.values(doc.nodes))
    if (node.type === 'collection-list') addUses(uses, [node.collection], `nodes.${node.id}`)
  for (const col of Object.values(doc.collections))
    for (const f of col.fields)
      if (f.type === 'reference' || f.type === 'multi-reference')
        addUses(uses, [f.reference], `collections.${col.id}.fields.${f.id}`, col.id)
  const readers = readersOfEntries(doc)
  for (const [collection, entries] of Object.entries(doc.entries))
    for (const entry of entries)
      for (const ref of readers.get(entry.id) ?? []) addUses(uses, [collection], ref)
  for (const [id, refs] of uses) uses.set(id, [...new Set(refs)].sort())
  return uses
}

export function referencesToCollection(doc: Document, id: string): string[] {
  return referencesToCollections(doc).get(id) ?? []
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
  for (const page of Object.values(doc.pages))
    if (Object.values(page.seo?.fields ?? {}).includes(fieldId)) out.push(`pages.${page.id}`)
  return out.sort()
}

export function designTokensUsingMode(doc: Document, modeId: string): string[] {
  return Object.values(doc.designTokens)
    .filter((t) => t.values[modeId] !== undefined)
    .map((t) => t.id)
    .sort()
}
