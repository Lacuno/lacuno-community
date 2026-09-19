import type { Document, Node } from '@freeflow/schema'

export function hasAnchorParent(doc: Document, node: Node): boolean {
  for (
    let parent = node.parent ? doc.nodes[node.parent] : undefined;
    parent;
    parent = parent.parent ? doc.nodes[parent.parent] : undefined
  ) {
    if ('tag' in parent && parent.tag === 'a') return true
  }
  return false
}
