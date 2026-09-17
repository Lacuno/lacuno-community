import { DocumentStore } from '@freeflow/document'
import { fixtureDocument } from '@freeflow/schema'
import { expect, it } from 'vitest'
import { captureEdit, type EditOperation } from '../src/history.js'
import { insertionTarget, presetNode, siblingMove, structureRestriction } from '../src/structure.js'

it('round-trips insertion, subtree edits and sibling moves with stable IDs', async () => {
  const original = fixtureDocument()
  const parent = original.nodes['n-hero-title']!.parent!
  let sequence = 0
  const node = presetNode('section', '', () => `n-insert-${++sequence}`)
  const operations: EditOperation[] = [
    { type: 'node.create', parent, node },
    {
      type: 'node.update',
      id: node.children![0]!.id,
      text: { type: 'static', value: 'Edited child' },
    },
    { type: 'node.move', id: node.id, parent, index: 0 },
  ]
  const entry = captureEdit(original, operations)
  const store = DocumentStore.inMemory(original)
  await store.apply({ expectedRevision: store.revision, operations })
  const edited = store.read().document
  expect(edited.nodes[parent]!.children[0]).toBe(node.id)
  await store.apply({ expectedRevision: store.revision, operations: entry.undo })
  expect({ ...store.read().document, revision: original.revision }).toEqual(original)
  await store.apply({ expectedRevision: store.revision, operations: entry.redo })
  expect({ ...store.read().document, revision: edited.revision }).toEqual(edited)
  const removal = captureEdit(store.read().document, [{ type: 'node.delete', id: node.id }])
  await store.apply({ expectedRevision: store.revision, operations: removal.redo })
  await store.apply({ expectedRevision: store.revision, operations: removal.undo })
  expect({ ...store.read().document, revision: edited.revision }).toEqual(edited)
})

it('offers valid destinations and protects locked ancestors and shared components', () => {
  const doc = fixtureDocument()
  const id = 'n-hero-title'
  const parent = doc.nodes[id]!.parent!
  expect(insertionTarget(doc, parent, id, 'after')).toEqual({
    parent,
    index: doc.nodes[parent]!.children.indexOf(id) + 1,
  })
  expect(insertionTarget(doc, parent, '', 'page').parent).toBe(parent)
  expect(() => insertionTarget(doc, parent, id, 'inside')).toThrow('container')
  expect(siblingMove(doc, parent, -1)).toBeUndefined()
  doc.nodes[parent]!.meta = { locked: true }
  expect(() => insertionTarget(doc, parent, id, 'after')).toThrow('locked')
  expect(siblingMove(doc, id, 1)).toBeUndefined()
  for (const component of Object.values(doc.components))
    expect(structureRestriction(doc, component.root)).toContain('Component')
})
