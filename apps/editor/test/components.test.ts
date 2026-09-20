import { DocumentStore } from '@freeflow/document'
import { fixtureDocument } from '@freeflow/schema'
import { expect, it } from 'vitest'
import {
  componentEditingDocument,
  componentWouldCycle,
  detachComponent,
  extractComponent,
  insertComponent,
} from '../src/components.js'
import { captureEdit, type EditOperation } from '../src/history.js'
import { structureRestriction } from '../src/structure.js'

it('extracts a component with exposed text, retaining IDs and round-tripping undo/redo', async () => {
  const original = fixtureDocument()
  const title = original.nodes['n-hero-title']!
  if (title.type === 'text') title.text = { type: 'static', value: 'Original title' }
  const edit = extractComponent(original, 'n-hero-title', 'Hero title', ['n-hero-title'])
  const history = captureEdit(original, edit.operations)
  const store = DocumentStore.inMemory(original)
  await store.apply({ expectedRevision: store.revision, operations: history.redo })
  const doc = store.read().document
  expect(doc.components[edit.component]!.root).toBe('n-hero-title')
  expect(doc.nodes['n-hero-title']!.parent).toBe(null)
  expect(doc.nodes['n-hero-title']).toMatchObject({ text: { type: 'prop', prop: 'content1' } })
  expect(doc.nodes[edit.instance]).toMatchObject({ type: 'component', component: edit.component })
  await store.apply({ expectedRevision: store.revision, operations: history.undo })
  expect({ ...store.read().document, revision: original.revision }).toEqual(original)
  await store.apply({ expectedRevision: store.revision, operations: history.redo })
  expect({ ...store.read().document, revision: doc.revision }).toEqual(doc)
})

it('inserts, customizes, detaches and restores an instance without changing shared defaults', async () => {
  const original = fixtureDocument()
  const title = original.nodes['n-hero-title']!
  if (title.type === 'text') title.text = { type: 'static', value: 'Original title' }
  const parent = original.nodes['n-hero-title']!.parent!
  const store = DocumentStore.inMemory(original)
  const extraction = extractComponent(original, 'n-hero-title', 'Title', ['n-hero-title'])
  await store.apply({ expectedRevision: store.revision, operations: extraction.operations })
  const insertion = insertComponent(
    store.read().document,
    extraction.component,
    parent,
    extraction.instance,
  )
  const inserted = captureEdit(store.read().document, insertion.operations)
  await store.apply({ expectedRevision: store.revision, operations: inserted.redo })
  const change: EditOperation[] = [
    {
      type: 'node.update',
      id: insertion.id,
      props: { content1: { type: 'static', value: 'Only this instance' } },
    },
  ]
  const contentHistory = captureEdit(store.read().document, change)
  await store.apply({ expectedRevision: store.revision, operations: change })
  const before = store.read().document
  const detach = detachComponent(before, insertion.id)
  const history = captureEdit(before, detach.operations)
  await store.apply({ expectedRevision: store.revision, operations: history.redo })
  expect(store.read().document.nodes[detach.node.id]).toMatchObject({
    type: 'text',
    text: { type: 'static', value: 'Only this instance' },
  })
  expect(store.read().document.components[extraction.component]).toEqual(
    before.components[extraction.component],
  )
  await store.apply({ expectedRevision: store.revision, operations: history.undo })
  expect({ ...store.read().document, revision: before.revision }).toEqual(before)
  await store.apply({ expectedRevision: store.revision, operations: contentHistory.undo })
  expect(store.read().document.nodes[insertion.id]).not.toHaveProperty('props')
  await store.apply({ expectedRevision: store.revision, operations: inserted.undo })
  expect(store.read().document.nodes[insertion.id]).toBeUndefined()
})

it('protects definitions outside explicit edit mode, rejects locks and indirect component cycles', () => {
  const doc = fixtureDocument()
  const component = doc.components['cmp-card']!
  expect(structureRestriction(doc, component.root)).toBeTruthy()
  expect(
    structureRestriction(componentEditingDocument(doc, component.id), component.root),
  ).toBeUndefined()
  expect(componentWouldCycle(doc, component.id, component.id)).toBe(true)
  expect(() =>
    insertComponent(doc, component.id, component.root, component.root, component.id),
  ).toThrow('itself')
  doc.components['cmp-wrapper'] = {
    id: 'cmp-wrapper',
    name: 'Wrapper',
    root: 'n-wrapper',
    props: [],
  }
  doc.nodes['n-wrapper'] = {
    id: 'n-wrapper',
    parent: null,
    type: 'component',
    component: component.id,
    children: [],
    classes: [],
  }
  expect(componentWouldCycle(doc, 'cmp-wrapper', component.id)).toBe(true)
  doc.nodes['n-hero-title']!.meta = { locked: true }
  expect(() => extractComponent(doc, 'n-hero-title', 'Locked', [])).toThrow('locked')
})

it('restores component names/defaults and preserves the linked instance when detach is unsupported', async () => {
  const doc = fixtureDocument()
  const store = DocumentStore.inMemory(doc)
  const history = captureEdit(doc, [
    {
      type: 'component.update',
      id: 'cmp-card',
      name: 'New name',
      props: doc.components['cmp-card']!.props,
    },
  ])
  await store.apply({ expectedRevision: store.revision, operations: history.redo })
  await store.apply({ expectedRevision: store.revision, operations: history.undo })
  expect({ ...store.read().document, revision: doc.revision }).toEqual(doc)
  const instance = Object.values(doc.nodes).find((node) => node.type === 'component')!
  if (instance.type !== 'component') throw new Error('Fixture needs a component')
  instance.overrides = ['n-card-title']
  const before = structuredClone(doc)
  expect(() => detachComponent(doc, instance.id)).toThrow()
  expect(doc).toEqual(before)
})
