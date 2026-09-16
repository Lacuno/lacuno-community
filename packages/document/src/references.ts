import type { Binding, CssValue, Document, NodeId } from '@freeflow/schema'

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
    default:
      return
  }
}

function bindingRefs(binding: Binding, into: Refs): void {
  if (binding.type === 'designToken') into.designTokens.add(binding.designToken)
  if (binding.type === 'asset') into.assets.add(binding.asset)
}

function nodeRefs(doc: Document): Map<NodeId, Refs> {
  const out = new Map<NodeId, Refs>()
  for (const node of Object.values(doc.nodes)) {
    const refs: Refs = { designTokens: new Set(), assets: new Set() }
    for (const b of Object.values(node.attrs ?? {})) bindingRefs(b, refs)
    if (node.type === 'text' && !('type' in node.text && node.text.type === 'doc'))
      bindingRefs(node.text as Binding, refs)
    if (node.type === 'component' || node.type === 'code-component')
      for (const b of Object.values(node.props ?? {})) bindingRefs(b, refs)
    out.set(node.id, refs)
  }
  return out
}

export function referencesToDesignToken(doc: Document, id: string): string[] {
  const out: string[] = []
  for (const [key, decl] of Object.entries(doc.styles)) {
    const refs: Refs = { designTokens: new Set(), assets: new Set() }
    cssValueReferences(decl.value, refs)
    if (refs.designTokens.has(id)) out.push(`styles.${key}`)
  }
  for (const token of Object.values(doc.designTokens)) {
    if (token.id === id) continue
    const refs: Refs = { designTokens: new Set(), assets: new Set() }
    for (const v of Object.values(token.values)) cssValueReferences(v, refs)
    if (refs.designTokens.has(id)) out.push(`designTokens.${token.id}`)
  }
  for (const [nodeId, refs] of nodeRefs(doc))
    if (refs.designTokens.has(id)) out.push(`nodes.${nodeId}`)
  return out.sort()
}

export function referencesToAsset(doc: Document, id: string): string[] {
  const out: string[] = []
  for (const [nodeId, refs] of nodeRefs(doc)) if (refs.assets.has(id)) out.push(`nodes.${nodeId}`)
  for (const [key, decl] of Object.entries(doc.styles)) {
    const refs: Refs = { designTokens: new Set(), assets: new Set() }
    cssValueReferences(decl.value, refs)
    if (refs.assets.has(id)) out.push(`styles.${key}`)
  }
  for (const token of Object.values(doc.designTokens)) {
    const refs: Refs = { designTokens: new Set(), assets: new Set() }
    for (const v of Object.values(token.values)) cssValueReferences(v, refs)
    if (refs.assets.has(id)) out.push(`designTokens.${token.id}`)
  }
  doc.site.fonts.forEach((f, i) => {
    if (f.asset === id) out.push(`site.fonts.${i}`)
  })
  if (doc.site.favicon === id) out.push('site.favicon')
  for (const page of Object.values(doc.pages))
    if (page.seo?.ogImage === id) out.push(`pages.${page.id}.seo.ogImage`)
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

export function designTokensUsingMode(doc: Document, modeId: string): string[] {
  return Object.values(doc.designTokens)
    .filter((t) => t.values[modeId] !== undefined)
    .map((t) => t.id)
    .sort()
}
