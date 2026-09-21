import type { Document, Node, NodeId } from '@freeflow/schema'

function snippet(node: Node): string {
  if (node.type !== 'text') return ''
  if (node.text.type === 'doc') {
    const words: string[] = []
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object') return
      const o = n as { text?: string; content?: unknown[] }
      if (typeof o.text === 'string') words.push(o.text)
      for (const c of o.content ?? []) walk(c)
    }
    walk(node.text)
    const s = words.join('')
    return s.length > 40 ? `${s.slice(0, 40)}…` : s
  }
  // Every binding but `static` names its target under a key equal to its own type.
  const b = node.text as { type: string } & Record<string, unknown>
  return `{${b.type}:${String(b.type === 'static' ? b.value : b[b.type])}}`
}

function label(node: Node): string {
  switch (node.type) {
    case 'element':
    case 'text':
      return node.tag
    case 'component':
      return `[component ${node.component}]`
    case 'slot':
      return `[slot ${node.name}]`
    case 'collection-list':
      return `[list ${node.collection}] ${node.tag}`
    case 'embed':
      return '[embed]'
    case 'code-component':
      return `[code ${node.source}]`
  }
}

/** One line per node: `<indent><id> <label> .class.names "snippet"`, depth-limited. */
export function outlineLines(
  doc: Document,
  rootId: NodeId,
  depth = Number.POSITIVE_INFINITY,
): string[] {
  const out: string[] = []
  const visit = (id: NodeId, level: number) => {
    const node = doc.nodes[id]
    if (!node || level > depth) return
    const cls = node.classes.map((c) => `.${c}`).join('')
    const snip = snippet(node)
    out.push(
      `${'  '.repeat(level)}${id} ${label(node)}${cls ? ` ${cls}` : ''}${snip ? ` "${snip}"` : ''}`,
    )
    for (const c of node.children) visit(c, level + 1)
  }
  visit(rootId, 0)
  return out
}
