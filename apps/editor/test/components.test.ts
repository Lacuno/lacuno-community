import { DocumentStore, type Operation } from '@freeflow/document'
import { fixtureDocument } from '@freeflow/schema'
import { expect, it } from 'vitest'
import {
  componentDeletionReason,
  componentEditingDocument,
  componentWouldCycle,
  detachComponent,
  duplicateComponent,
  extractComponent,
  fieldRemovalReason,
  insertComponent,
  updateComponentFields,
} from '../src/components.js'
import { structureRestriction } from '../src/structure.js'
import { commit } from './helpers.js'

it('duplicates definitions with fresh nodes and local styles, then deletes and restores unused copies', async () => {
  const store = DocumentStore.inMemory(fixtureDocument())
  await store.apply({
    expectedRevision: store.revision,
    operations: [
      { type: 'class.create', id: 'c-component-local', local: true },
      {
        type: 'style.set',
        class: 'c-component-local',
        breakpoint: 'base',
        state: 'none',
        property: 'color',
        value: { type: 'raw', value: 'red' },
      },
      {
        type: 'component.create',
        id: 'cmp-test',
        name: 'Test',
        root: {
          type: 'element',
          tag: 'div',
          classes: ['c-component-local'],
          children: [{ type: 'component', component: 'cmp-card' }],
        },
      },
    ],
  })
  const before = store.read().document
  const duplicate = await commit(store, duplicateComponent(before, 'cmp-test', 'Test copy'))
  const doc = store.read().document
  const copied = Object.values(doc.components).find((component) => component.name === 'Test copy')!
  const root = doc.nodes[copied.root]!
  expect(copied.root).not.toBe(before.components['cmp-test']!.root)
  expect(root.classes).not.toEqual(['c-component-local'])
  expect(doc.nodes[root.children[0]!]).toMatchObject({ type: 'component', component: 'cmp-card' })
  expect(componentDeletionReason(doc, 'cmp-card')).toContain('Used by')
  expect(componentDeletionReason(doc, copied.id)).toBe('')
  expect(() => duplicateComponent(doc, 'cmp-test', 'Test copy')).toThrow('already')
  const deletion = await commit(store, [{ type: 'component.delete', id: copied.id }])
  expect(store.read().document.components[copied.id]).toBeUndefined()
  expect(store.read().document.components['cmp-card']).toEqual(doc.components['cmp-card'])
  await store.apply({ expectedRevision: store.revision, patches: deletion.undo })
  expect({ ...store.read().document, revision: doc.revision }).toEqual(doc)
  await store.apply({ expectedRevision: store.revision, patches: duplicate.undo })
  expect({ ...store.read().document, revision: before.revision }).toEqual(before)
})

it('manages fields after creation with stable keys, safe removal and atomic undo', async () => {
  const original = fixtureDocument()
  const title = original.nodes['n-hero-title']!
  if (title.type === 'text') title.text = { type: 'static', value: 'Original title' }
  const extraction = extractComponent(original, 'n-hero-title', 'Title', [])
  const store = DocumentStore.inMemory(original)
  await store.apply({ expectedRevision: store.revision, operations: extraction.operations })
  const before = store.read().document
  const component = before.components[extraction.component]!
  const props = [
    { name: 'headline', type: 'string' as const, label: 'Headline', default: 'Original title' },
  ]
  const added = await commit(
    store,
    updateComponentFields(before, component, component.name, props, { 'n-hero-title': 'headline' }),
  )
  expect(store.read().document.nodes['n-hero-title']).toMatchObject({
    text: { type: 'prop', prop: 'headline' },
  })
  await store.apply({ expectedRevision: store.revision, patches: added.undo })
  expect({ ...store.read().document, revision: before.revision }).toEqual(before)
  await store.apply({ expectedRevision: store.revision, patches: added.redo })
  await store.apply({
    expectedRevision: store.revision,
    operations: [
      {
        type: 'node.update',
        id: extraction.instance,
        props: { headline: { type: 'static', value: 'Custom title' } },
      },
    ],
  })
  let doc = store.read().document
  const renamed = updateComponentFields(
    doc,
    doc.components[component.id]!,
    component.name,
    [{ ...props[0]!, label: 'New label' }],
    {},
  )
  await store.apply({ expectedRevision: store.revision, operations: renamed })
  doc = store.read().document
  expect(doc.nodes[extraction.instance]).toMatchObject({
    props: { headline: { value: 'Custom title' } },
  })
  expect(fieldRemovalReason(doc, doc.components[component.id]!, 'headline')).toContain(
    'custom content',
  )
  expect(() =>
    updateComponentFields(doc, doc.components[component.id]!, component.name, [], {}),
  ).toThrow('custom content')
  await store.apply({
    expectedRevision: store.revision,
    operations: [{ type: 'node.update', id: extraction.instance, props: null }],
  })
  doc = store.read().document
  const removed = await commit(
    store,
    updateComponentFields(doc, doc.components[component.id]!, component.name, [], {}),
  )
  expect(store.read().document.nodes['n-hero-title']).toMatchObject({
    text: { type: 'static', value: 'Original title' },
  })
  expect(store.read().document.components[component.id]!.props).toEqual([])
  await store.apply({ expectedRevision: store.revision, patches: removed.undo })
  expect({ ...store.read().document, revision: doc.revision }).toEqual(doc)
  expect(() =>
    updateComponentFields(
      doc,
      doc.components[component.id]!,
      component.name,
      [{ ...props[0]!, label: ' ' }],
      {},
    ),
  ).toThrow('name')
  expect(() =>
    updateComponentFields(
      doc,
      doc.components[component.id]!,
      component.name,
      [...props, { ...props[0]!, name: 'other' }],
      {},
    ),
  ).toThrow('unique')
  doc = structuredClone(doc)
  doc.nodes['n-hero-title']!.attrs = { title: { type: 'prop', prop: 'headline' } }
  expect(fieldRemovalReason(doc, doc.components[component.id]!, 'headline')).toContain('attribute')
  delete doc.nodes['n-hero-title']!.attrs
  doc.nodes['n-hero-title']!.meta = { locked: true }
  expect(fieldRemovalReason(doc, doc.components[component.id]!, 'headline')).toContain('protected')
})

it('extracts a component with exposed text, retaining IDs and round-tripping undo/redo', async () => {
  const original = fixtureDocument()
  const title = original.nodes['n-hero-title']!
  if (title.type === 'text') title.text = { type: 'static', value: 'Original title' }
  const edit = extractComponent(original, 'n-hero-title', 'Hero title', ['n-hero-title'])
  const store = DocumentStore.inMemory(original)
  const history = await commit(store, edit.operations)
  const doc = store.read().document
  expect(doc.components[edit.component]!.root).toBe('n-hero-title')
  expect(doc.nodes['n-hero-title']!.parent).toBe(null)
  expect(doc.nodes['n-hero-title']).toMatchObject({ text: { type: 'prop', prop: 'content1' } })
  expect(doc.nodes[edit.instance]).toMatchObject({ type: 'component', component: edit.component })
  await store.apply({ expectedRevision: store.revision, patches: history.undo })
  expect({ ...store.read().document, revision: original.revision }).toEqual(original)
  await store.apply({ expectedRevision: store.revision, patches: history.redo })
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
  const inserted = await commit(store, insertion.operations)
  const change: Operation[] = [
    {
      type: 'node.update',
      id: insertion.id,
      props: { content1: { type: 'static', value: 'Only this instance' } },
    },
  ]
  const contentHistory = await commit(store, change)
  const before = store.read().document
  const detach = detachComponent(before, insertion.id)
  const history = await commit(store, detach.operations)
  expect(store.read().document.nodes[detach.node.id]).toMatchObject({
    type: 'text',
    text: { type: 'static', value: 'Only this instance' },
  })
  expect(store.read().document.components[extraction.component]).toEqual(
    before.components[extraction.component],
  )
  await store.apply({ expectedRevision: store.revision, patches: history.undo })
  expect({ ...store.read().document, revision: before.revision }).toEqual(before)
  await store.apply({ expectedRevision: store.revision, patches: contentHistory.undo })
  expect(store.read().document.nodes[insertion.id]).not.toHaveProperty('props')
  await store.apply({ expectedRevision: store.revision, patches: inserted.undo })
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
  const history = await commit(store, [
    {
      type: 'component.update',
      id: 'cmp-card',
      name: 'New name',
      props: doc.components['cmp-card']!.props,
    },
  ])
  await store.apply({ expectedRevision: store.revision, patches: history.undo })
  expect({ ...store.read().document, revision: doc.revision }).toEqual(doc)
  const instance = Object.values(doc.nodes).find((node) => node.type === 'component')!
  if (instance.type !== 'component') throw new Error('Fixture needs a component')
  instance.overrides = ['n-card-title']
  const before = structuredClone(doc)
  expect(() => detachComponent(doc, instance.id)).toThrow()
  expect(doc).toEqual(before)
})
