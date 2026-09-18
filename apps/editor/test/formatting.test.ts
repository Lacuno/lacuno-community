import { DocumentStore } from '@freeflow/document'
import { fixtureDocument, styleKey } from '@freeflow/schema'
import { expect, it } from 'vitest'
import { formattingOperations, localClass, normalizeFormatting } from '../src/formatting.js'
import { captureEdit } from '../src/history.js'

it('formats only the selected element and round-trips automatic local style creation', async () => {
  const doc = fixtureDocument()
  const node = doc.nodes['n-hero-title']!
  node.classes = node.classes.filter((id) => doc.classes[id]!.kind !== 'local')
  const original = structuredClone(doc)
  const operations = formattingOperations(
    doc,
    node,
    { 'font-size': { type: 'unit', value: 31, unit: 'px' } },
    () => 'c-direct',
  )
  const entry = captureEdit(doc, operations)
  const store = DocumentStore.inMemory(doc)
  await store.apply({ expectedRevision: store.revision, operations })
  const edited = store.read().document
  expect(localClass(edited, edited.nodes[node.id]!)).toBe('c-direct')
  for (const [key, style] of Object.entries(original.styles))
    expect(edited.styles[key]).toEqual(style)
  for (const other of Object.values(original.nodes).filter((item) => item.id !== node.id))
    expect(edited.nodes[other.id]).toEqual(other)
  await store.apply({ expectedRevision: store.revision, operations: entry.undo })
  expect({ ...store.read().document, revision: original.revision }).toEqual(original)
  await store.apply({ expectedRevision: store.revision, operations: entry.redo })
  expect({ ...store.read().document, revision: edited.revision }).toEqual(edited)
  const reset = formattingOperations(edited, edited.nodes[node.id]!, { 'font-size': null })
  const resetHistory = captureEdit(edited, reset)
  await store.apply({ expectedRevision: store.revision, operations: reset })
  expect(
    Object.values(store.read().document.styles).some((style) => style.class === 'c-direct'),
  ).toBe(false)
  await store.apply({ expectedRevision: store.revision, operations: resetHistory.undo })
  expect({ ...store.read().document, revision: edited.revision }).toEqual(edited)
})

it('reuses private styles, isolates accidentally shared locals and preserves importance', () => {
  const doc = fixtureDocument()
  const node = doc.nodes['n-hero-title']!
  const local = localClass(doc, node)!
  expect(local).toBeTruthy()
  expect(formattingOperations(doc, node, { color: { type: 'color', value: '#fff' } })).toHaveLength(
    1,
  )
  const other = Object.values(doc.nodes).find((item) => item.id !== node.id)!
  other.classes.push(local)
  doc.styles[
    styleKey({ class: node.classes[0]!, breakpoint: 'base', state: 'none', property: 'color' })
  ] = {
    class: node.classes[0]!,
    breakpoint: 'base',
    state: 'none',
    property: 'color',
    value: { type: 'color', value: '#000' },
    important: true,
  }
  const operations = formattingOperations(
    doc,
    node,
    { color: { type: 'color', value: '#fff' } },
    () => 'c-isolated',
  )
  expect(operations[0]).toEqual({ type: 'class.create', id: 'c-isolated', local: true })
  expect(operations[1]).toMatchObject({
    type: 'node.update',
    classes: [...node.classes.filter((id) => doc.classes[id]?.kind !== 'local'), 'c-isolated'],
  })
  expect(
    operations.some(
      (operation) =>
        operation.type === 'style.set' &&
        operation.property === 'letter-spacing' &&
        operation.class === 'c-isolated',
    ),
  ).toBe(true)
  expect(operations.at(-1)).toMatchObject({
    type: 'style.set',
    class: 'c-isolated',
    important: true,
  })
  expect(formattingOperations(doc, node, { color: null })).toEqual([])
})

it('accepts pixel sizes without requiring CSS units', () => {
  expect(
    normalizeFormatting({
      'font-size': { type: 'raw', value: '24' },
      'line-height': { type: 'raw', value: '1.5' },
    }),
  ).toEqual({
    'font-size': { type: 'unit', value: 24, unit: 'px' },
    'line-height': { type: 'raw', value: '1.5' },
  })
})
