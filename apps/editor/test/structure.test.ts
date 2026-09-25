import { DocumentStore, type Operation } from '@lacuno/document'
import { fixtureDocument, type Node } from '@lacuno/schema'
import { expect, it } from 'vitest'
import {
  dropEdit,
  dropTarget,
  duplicateSelection,
  insertionTarget,
  presetNode,
  siblingMove,
  structureInsertion,
  structureRestriction,
  subtreeRestriction,
  toggleAttr,
  wrappers,
  wrapSelection,
} from '../src/structure.js'
import { commit } from './helpers.js'

/** The properties a preset's local class declares, keyed by property. */
const styleValues = (operations: Operation[]) =>
  Object.fromEntries(
    operations.flatMap((operation) =>
      operation.type === 'style.set' && operation.value.type === 'raw'
        ? [[operation.property, operation.value.value]]
        : [],
    ),
  )

it('round-trips insertion, subtree edits and sibling moves with stable IDs', async () => {
  const original = fixtureDocument()
  const parent = original.nodes['n-hero-title']!.parent!
  const node = presetNode('section', '')
  const operations: Operation[] = [
    { type: 'node.create', parent, node },
    {
      type: 'node.update',
      id: node.children![0]!.id,
      text: { type: 'static', value: 'Edited child' },
    },
    { type: 'node.move', id: node.id, parent, index: 0 },
  ]
  const store = DocumentStore.inMemory(original)
  const entry = await commit(store, operations)
  const edited = store.read().document
  expect(edited.nodes[parent]!.children[0]).toBe(node.id)
  await store.apply({ expectedRevision: store.revision, patches: entry.undo })
  expect({ ...store.read().document, revision: original.revision }).toEqual(original)
  await store.apply({ expectedRevision: store.revision, patches: entry.redo })
  expect({ ...store.read().document, revision: edited.revision }).toEqual(edited)
  const removal = await commit(store, [{ type: 'node.delete', id: node.id }])
  await store.apply({ expectedRevision: store.revision, patches: removal.undo })
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

it.each(wrappers)(
  'wraps content in %s without losing identity and restores it on undo',
  async (preset) => {
    const original = fixtureDocument()
    const id = 'n-hero-title'
    const before = original.nodes[id]!
    const parent = original.nodes[before.parent!]!
    const { node, operations } = wrapSelection(original, id, preset)
    const store = DocumentStore.inMemory(original)
    const entry = await commit(store, operations)
    const edited = store.read().document
    expect(edited.nodes[parent.id]!.children[parent.children.indexOf(id)]).toBe(node.id)
    expect(edited.nodes[node.id]!.children).toEqual([id])
    expect(edited.nodes[id]).toEqual({ ...before, parent: node.id })
    expect(Object.values(edited.styles).some((style) => node.classes.includes(style.class))).toBe(
      true,
    )
    await store.apply({ expectedRevision: store.revision, patches: entry.undo })
    expect({ ...store.read().document, revision: original.revision }).toEqual(original)
    await store.apply({ expectedRevision: store.revision, patches: entry.redo })
    expect({ ...store.read().document, revision: edited.revision }).toEqual(edited)
  },
)

it('builds link and button presets bound to the current page', () => {
  const link = presetNode('link', '', '', 'p-home')
  expect(link).toMatchObject({
    type: 'text',
    tag: 'a',
    text: { type: 'static', value: 'Link' },
    meta: { label: 'Link' },
    attrs: { href: { type: 'page', page: 'p-home' } },
  })
  expect(link.classes).toEqual([])
  const button = structureInsertion(
    'button',
    { parent: 'n-hero-inner', index: 0 },
    '',
    false,
    '',
    'p-home',
  )
  expect(button.node).toMatchObject({
    tag: 'a',
    text: { type: 'static', value: 'Button' },
    meta: { label: 'Button' },
    attrs: { href: { type: 'page', page: 'p-home' } },
  })
  expect(button.operations).toContainEqual({
    type: 'class.create',
    id: button.node.classes[0],
    local: true,
  })
  expect(styleValues(button.operations)).toEqual({
    display: 'inline-block',
    padding: '12px 20px',
    'border-radius': '8px',
    background: '#6434d9',
    color: 'white',
    'text-decoration': 'none',
    'font-weight': '600',
  })
})

it('builds span, list, video and embed presets with their default styles', async () => {
  const target = { parent: 'n-hero-inner', index: 0 }
  const span = structureInsertion('span', target)
  expect(span.node).toMatchObject({ type: 'text', tag: 'span', text: { value: 'Span' } })
  expect(span.operations.map((operation) => operation.type)).toEqual(['node.create'])
  const list = structureInsertion('list', target)
  expect(list.node).toMatchObject({ type: 'element', tag: 'ul', meta: { label: 'List' } })
  expect(list.node.children?.map((item) => item.type === 'text' && [item.tag, item.text])).toEqual(
    ['First item', 'Second item', 'Third item'].map((value) => ['li', { type: 'static', value }]),
  )
  expect(list.operations.filter((operation) => operation.type === 'class.create')).toHaveLength(1)
  expect(styleValues(list.operations)).toEqual({ 'padding-left': '24px', margin: '0' })
  const video = structureInsertion('video', target, '', false, 'a-hero')
  expect(video.node).toMatchObject({
    tag: 'video',
    attrs: {
      src: { type: 'asset', asset: 'a-hero' },
      controls: { type: 'static', value: true },
      playsinline: { type: 'static', value: true },
    },
  })
  expect(styleValues(video.operations)).toEqual({
    display: 'block',
    width: '100%',
    'max-width': '100%',
    height: 'auto',
  })
  expect(presetNode('video', '').attrs).not.toHaveProperty('src')
  const embed = structureInsertion('embed', target)
  expect(embed.node).toMatchObject({ type: 'embed', html: '', meta: { label: 'Embed' } })
  expect(structureInsertion('embed', target, 'c-button').node.classes).toEqual(['c-button'])
  expect(embed.operations.map((operation) => operation.type)).toEqual(['node.create'])
  const store = DocumentStore.inMemory(fixtureDocument())
  await commit(store, [
    ...span.operations,
    ...list.operations,
    ...video.operations,
    ...embed.operations,
  ])
  const doc = store.read().document
  expect(doc.nodes[list.node.children![1]!.id]!.parent).toBe(list.node.id)
  expect(subtreeRestriction(doc, embed.node.id)).toBeUndefined()
})

it('toggles boolean video attributes and mutes when autoplay turns on', () => {
  const video = { ...presetNode('video', ''), parent: null, children: [] } as Node
  const on = { type: 'static', value: true }
  expect(toggleAttr(video, 'autoplay', true)).toEqual({
    type: 'node.update',
    id: video.id,
    attrs: { controls: on, playsinline: on, autoplay: on, muted: on },
  })
  expect(toggleAttr(video, 'controls', false)).toEqual({
    type: 'node.update',
    id: video.id,
    attrs: { playsinline: on },
  })
})

it('wraps a selection in a link and refuses to nest one link inside another', () => {
  const doc = fixtureDocument()
  const wrap = wrapSelection(doc, 'n-hero-title', 'link')
  expect(wrap.node).toMatchObject({
    type: 'element',
    tag: 'a',
    attrs: { href: { type: 'page', page: 'p-home' } },
  })
  expect(styleValues(wrap.operations)).toEqual({
    display: 'block',
    color: 'inherit',
    'text-decoration': 'none',
  })
  // The selection is already a link.
  expect(() => wrapSelection(doc, 'n-hero-cta', 'link')).toThrow('another link')
  const nested = fixtureDocument()
  ;(nested.nodes['n-hero'] as { tag: string }).tag = 'a'
  expect(() => wrapSelection(nested, 'n-hero-title', 'link')).toThrow('another link')
})

it('protects roots and locked selections from wrapping and creates empty layout blocks', () => {
  const doc = fixtureDocument()
  const root = Object.values(doc.nodes).find((node) => !node.parent)!
  expect(() => wrapSelection(doc, root.id, 'row')).toThrow()
  doc.nodes['n-hero-title']!.meta = { locked: true }
  expect(() => wrapSelection(doc, 'n-hero-title', 'row')).toThrow('locked')
  for (const preset of ['stack', 'row', 'grid'] as const) {
    const result = structureInsertion(preset, { parent: root.id, index: 0 })
    expect(result.node.children).toEqual([])
    expect(result.operations).toContainEqual(
      expect.objectContaining({
        type: 'style.set',
        property: 'display',
        value: { type: 'raw', value: preset === 'grid' ? 'grid' : 'flex' },
      }),
    )
  }
})

it('drops before and after siblings with post-removal indices and reversible reparenting', async () => {
  const original = fixtureDocument()
  const parent = original.nodes['n-hero-title']!.parent!
  const root = parent
  const store = DocumentStore.inMemory(original)
  const inserted = structureInsertion('stack', { parent, index: 0 })
  await store.apply({ expectedRevision: store.revision, operations: inserted.operations })
  const doc = store.read().document
  const siblings = doc.nodes[parent]!.children
  const first = siblings[0]!
  const last = siblings.at(-1)!
  expect(dropTarget(doc, root, { id: first }, last, 'after').index).toBe(siblings.length - 1)
  expect(dropTarget(doc, root, { id: last }, first, 'before').index).toBe(0)
  expect(dropEdit(doc, root, { id: first }, first, 'after').operations).toEqual([])
  const edit = dropEdit(doc, root, { id: 'n-hero-title' }, first, 'inside')
  const history = await commit(store, edit.operations)
  expect(store.read().document.nodes[first]!.children).toEqual(['n-hero-title'])
  await store.apply({ expectedRevision: store.revision, patches: history.undo })
  expect({ ...store.read().document, revision: doc.revision }).toEqual(doc)
})

it('rejects drag cycles, locked content, text containers and page-root moves', () => {
  const doc = fixtureDocument()
  const child = 'n-hero-title'
  const root = doc.nodes[child]!.parent!
  expect(() => dropTarget(doc, root, { id: root }, child, 'after')).toThrow()
  expect(() => dropTarget(doc, root, { preset: 'row' }, child, 'inside')).toThrow()
  expect(() => dropTarget(doc, root, { id: child }, child, 'inside')).toThrow()
  doc.nodes[child]!.meta = { locked: true }
  expect(() => dropTarget(doc, root, { id: child }, root, 'inside')).toThrow()
  expect(() => dropTarget(doc, root, { preset: 'heading' }, child, 'after')).toThrow()
  for (const component of Object.values(doc.components))
    expect(() => dropTarget(doc, root, { preset: 'row' }, component.root, 'inside')).toThrow()
})

it('rejects moving a container into a descendant and round-trips drag insertion', async () => {
  const doc = fixtureDocument()
  const root = doc.nodes['n-hero-title']!.parent!
  const store = DocumentStore.inMemory(doc)
  const row = dropEdit(doc, root, { preset: 'row' }, 'n-hero-title', 'after')
  const history = await commit(store, row.operations)
  const child = dropEdit(store.read().document, root, { preset: 'stack' }, row.node.id, 'inside')
  const childHistory = await commit(store, child.operations)
  expect(() =>
    dropTarget(store.read().document, root, { id: row.node.id }, child.node.id, 'inside'),
  ).toThrow('itself')
  await store.apply({ expectedRevision: store.revision, patches: childHistory.undo })
  await store.apply({ expectedRevision: store.revision, patches: history.undo })
  expect({ ...store.read().document, revision: doc.revision }).toEqual(doc)
})

it('duplicates a subtree with independent local styles and unique HTML ids, then undoes exactly', async () => {
  const doc = fixtureDocument()
  const id = 'n-hero-title'
  doc.nodes[id]!.attrs = {
    id: { type: 'static', value: 'hero-title' },
    'aria-labelledby': { type: 'static', value: 'hero-title' },
  }
  const edit = duplicateSelection(doc, id)
  const store = DocumentStore.inMemory(doc)
  const history = await commit(store, edit.operations)
  const result = store.read().document
  const copy = result.nodes[edit.node.id]!
  expect(copy.id).not.toBe(id)
  expect(copy.attrs!.id).not.toEqual(doc.nodes[id]!.attrs!.id)
  expect(copy.attrs!['aria-labelledby']).toEqual(copy.attrs!.id)
  for (const cls of copy.classes.filter((cls) => result.classes[cls]?.kind === 'local'))
    expect(doc.nodes[id]!.classes).not.toContain(cls)
  await store.apply({ expectedRevision: store.revision, patches: history.undo })
  expect({ ...store.read().document, revision: doc.revision }).toEqual(doc)
  expect(subtreeRestriction(doc, '')).toBeTruthy()
  doc.nodes[id]!.meta = { locked: true }
  expect(() => duplicateSelection(doc, id)).toThrow('locked')
})

it('renames an element and restores absent metadata exactly', async () => {
  const doc = fixtureDocument()
  const id = 'n-hero-title'
  delete doc.nodes[id]!.meta
  const operations: Operation[] = [{ type: 'node.update', id, meta: { label: 'Hero title' } }]
  const store = DocumentStore.inMemory(doc)
  const history = await commit(store, operations)
  expect(store.read().document.nodes[id]!.meta?.label).toBe('Hero title')
  await store.apply({ expectedRevision: store.revision, patches: history.undo })
  expect({ ...store.read().document, revision: doc.revision }).toEqual(doc)
})

it('round-trips image registration, insertion, replacement and alt text through history', async () => {
  const doc = fixtureDocument()
  const originalAsset = Object.values(doc.assets)[0]!
  const asset = { ...originalAsset, id: 'a-new-image', name: 'New image' }
  const parent = doc.nodes['n-hero-title']!.parent!
  const inserted = structureInsertion('image', { parent, index: 0 }, '', false, asset.id)
  const operations: Operation[] = [{ type: 'asset.create', ...asset }, ...inserted.operations]
  const store = DocumentStore.inMemory(doc)
  const history = await commit(store, operations)
  const beforeEdit = store.read().document
  const update: Operation[] = [
    {
      type: 'node.update',
      id: inserted.node.id,
      attrs: {
        src: { type: 'asset', asset: originalAsset.id },
        alt: { type: 'static', value: 'A description' },
      },
    },
  ]
  const updateHistory = await commit(store, update)
  expect(store.read().document.nodes[inserted.node.id]!.attrs!.alt).toEqual({
    type: 'static',
    value: 'A description',
  })
  await store.apply({ expectedRevision: store.revision, patches: updateHistory.undo })
  expect({ ...store.read().document, revision: beforeEdit.revision }).toEqual(beforeEdit)
  await store.apply({ expectedRevision: store.revision, patches: history.undo })
  expect({ ...store.read().document, revision: doc.revision }).toEqual(doc)
})

it('inserts an image without selecting an existing asset and restores its placeholder on undo', async () => {
  const doc = fixtureDocument()
  const parent = doc.nodes['n-hero-title']!.parent!
  const inserted = structureInsertion('image', { parent, index: 0 })
  const store = DocumentStore.inMemory(doc)
  await store.apply({ expectedRevision: store.revision, operations: inserted.operations })
  const node = store.read().document.nodes[inserted.node.id]!
  expect(node.attrs?.src).toBeUndefined()
  const asset = Object.values(doc.assets)[0]!
  const edit = await commit(store, [
    {
      type: 'node.update',
      id: node.id,
      attrs: { ...node.attrs, src: { type: 'asset', asset: asset.id } },
    },
  ])
  await store.apply({ expectedRevision: store.revision, patches: edit.undo })
  expect(store.read().document.nodes[node.id]).toEqual(node)
})
