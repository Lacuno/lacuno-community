import { DocumentStore } from '@freeflow/document'
import { fixtureDocument, styleKey } from '@freeflow/schema'
import { expect, it } from 'vitest'
import { formattingOperations } from '../src/formatting.js'
import { captureEdit } from '../src/history.js'
import {
  activePreset,
  applyPreset,
  createPreset,
  presetOverrides,
  presetValues,
  updatePreset,
} from '../src/presets.js'

it('creates a linked preset with typed colors and round-trips create, undo and redo', async () => {
  const doc = fixtureDocument()
  const node = doc.nodes['n-hero-title']!
  const color = {
    class: 'l-hero-title',
    breakpoint: 'base',
    state: 'none' as const,
    property: 'color',
    value: { type: 'designToken' as const, ref: 't-brand' },
  }
  doc.styles[styleKey(color)] = color
  const original = structuredClone(doc)
  const values = presetValues(doc, node, {})
  const operations = createPreset(doc, node, 'Page heading', {}, 'c-preset')
  const entry = captureEdit(doc, operations)
  const store = DocumentStore.inMemory(doc)
  await store.apply({ expectedRevision: store.revision, operations })
  const created = store.read().document
  expect(activePreset(created, created.nodes[node.id]!)?.name).toBe('Page heading')
  expect(presetOverrides(created, created.nodes[node.id]!)).toEqual([])
  for (const [property, value] of Object.entries(values)) {
    expect(
      created.styles[styleKey({ class: 'c-preset', breakpoint: 'base', state: 'none', property })]
        ?.value,
    ).toEqual(value)
  }
  await store.apply({ expectedRevision: store.revision, operations: entry.undo })
  expect({ ...store.read().document, revision: original.revision }).toEqual(original)
  await store.apply({ expectedRevision: store.revision, operations: entry.redo })
  expect({ ...store.read().document, revision: created.revision }).toEqual(created)
  expect(() => createPreset(created, node, 'page heading', {})).toThrow('already in use')
})

it('updates the shared preset only explicitly, resets overrides, and restores both with undo', async () => {
  const store = DocumentStore.inMemory(fixtureDocument())
  const get = () => store.read().document
  const nodeId = 'n-hero-title'
  await store.apply({
    expectedRevision: store.revision,
    operations: createPreset(get(), get().nodes[nodeId]!, 'Reusable heading', {}, 'c-preset'),
  })
  const other = Object.values(get().nodes).find(
    (node) => node.id !== nodeId && node.type === 'text',
  )!
  await store.apply({
    expectedRevision: store.revision,
    operations: applyPreset(get(), other, 'c-preset'),
  })
  const key = styleKey({
    class: 'c-preset',
    breakpoint: 'base',
    state: 'none',
    property: 'font-size',
  })
  const previous = get().styles[key]
  await store.apply({
    expectedRevision: store.revision,
    operations: formattingOperations(get(), get().nodes[nodeId]!, {
      'font-size': { type: 'unit', value: 42, unit: 'px' },
    }),
  })
  expect(get().styles[key]).toEqual(previous)
  const before = get()
  const operations = updatePreset(before, before.nodes[nodeId]!)
  const history = captureEdit(before, operations)
  await store.apply({ expectedRevision: store.revision, operations })
  expect(get().styles[key]?.value).toEqual({ type: 'unit', value: 42, unit: 'px' })
  expect(get().nodes[other.id]?.classes).toContain('c-preset')
  expect(presetOverrides(get(), get().nodes[nodeId]!)).toEqual([])
  await store.apply({ expectedRevision: store.revision, operations: history.undo })
  expect({ ...get(), revision: before.revision }).toEqual(before)
  await store.apply({
    expectedRevision: store.revision,
    operations: applyPreset(get(), get().nodes[nodeId]!, 'c-preset'),
  })
  expect(presetOverrides(get(), get().nodes[nodeId]!)).toEqual([])
  expect(get().styles[key]).toEqual(previous)
})

it('isolates shared local styles when applying a preset', async () => {
  const doc = fixtureDocument()
  const node = doc.nodes['n-hero-title']!
  const local = node.classes.find((id) => doc.classes[id]?.kind === 'local')!
  const other = Object.values(doc.nodes).find((item) => item.id !== node.id)!
  other.classes.push(local)
  doc.classes['c-preset'] = { id: 'c-preset', kind: 'class', name: 'Preset', preset: true }
  const color = {
    class: local,
    breakpoint: 'base',
    state: 'none' as const,
    property: 'color',
    value: { type: 'designToken' as const, ref: 't-brand' },
  }
  doc.styles[styleKey(color)] = color
  const originalOther = structuredClone(other)
  const styles = structuredClone(doc.styles)
  const store = DocumentStore.inMemory(doc)
  await store.apply({
    expectedRevision: store.revision,
    operations: applyPreset(doc, node, 'c-preset'),
  })
  const after = store.read().document
  expect(after.nodes[other.id]).toEqual(originalOther)
  expect(after.nodes[node.id]?.classes).not.toContain(local)
  for (const [key, style] of Object.entries(styles).filter(([, style]) => style.class === local))
    expect(after.styles[key]).toEqual(style)
})
