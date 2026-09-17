import { DocumentStore } from '@freeflow/document'
import { fixtureDocument, styleKey } from '@freeflow/schema'
import { expect, it } from 'vitest'
import {
  captureEdit,
  committedHistory,
  type EditOperation,
  emptyHistory,
  historyShortcut,
} from '../src/history.js'

it('undoes one mixed save exactly, including rich text, tokens, important and missing styles', async () => {
  const original = fixtureDocument()
  const color = { class: 'c-page', breakpoint: 'base', state: 'none' as const, property: 'color' }
  original.styles[styleKey(color)]!.important = true
  const operations: EditOperation[] = [
    { type: 'node.update', id: 'n-hero-title', text: { type: 'static', value: 'New heading' } },
    { type: 'style.set', ...color, value: { type: 'color', value: '#ffffff' } },
    { type: 'style.set', ...color, value: { type: 'color', value: '#000000' } },
    { type: 'style.clear', ...color, property: 'font-family' },
    {
      type: 'style.set',
      ...color,
      property: 'outline-offset',
      value: { type: 'unit', value: 2, unit: 'px' },
    },
  ]
  const untouched = structuredClone(original)
  const entry = captureEdit(original, operations)
  expect(original).toEqual(untouched)
  const store = DocumentStore.inMemory(original)
  await store.apply({ expectedRevision: store.revision, operations })
  const edited = store.read().document
  await store.apply({ expectedRevision: store.revision, operations: entry.undo })
  expect({ ...store.read().document, revision: original.revision }).toEqual(original)
  await store.apply({ expectedRevision: store.revision, operations: entry.redo })
  expect({ ...store.read().document, revision: edited.revision }).toEqual(edited)
})

it('keeps rejected undos from overwriting a later revision', async () => {
  const original = fixtureDocument()
  const edits: EditOperation[] = [
    { type: 'node.update', id: 'n-hero-title', text: { type: 'static', value: 'Mine' } },
  ]
  const entry = captureEdit(original, edits)
  const store = DocumentStore.inMemory(original)
  await store.apply({ expectedRevision: store.revision, operations: edits })
  const revision = store.revision
  await store.apply({
    expectedRevision: revision,
    operations: [
      { type: 'node.update', id: 'n-hero-title', text: { type: 'static', value: 'Someone else' } },
    ],
  })
  const latest = store.read()
  await expect(store.apply({ expectedRevision: revision, operations: entry.undo })).rejects.toThrow(
    'stale revision',
  )
  expect(store.read()).toEqual(latest)
})

it('clears redo after a new edit and bounds history to 100 saved batches', () => {
  const entry = captureEdit(fixtureDocument(), [
    { type: 'node.update', id: 'n-hero-title', text: { type: 'static', value: 'Changed' } },
  ])
  let history = committedHistory(emptyHistory(), 'edit', entry)
  history = committedHistory(history, 'undo', entry)
  expect(history.undo).toEqual([])
  expect(history.redo).toEqual([entry])
  history = committedHistory(history, 'redo', entry)
  expect(history.undo).toEqual([entry])
  expect(history.redo).toEqual([])
  history = committedHistory(committedHistory(history, 'undo', entry), 'edit', entry)
  expect(history.redo).toEqual([])
  for (let i = 0; i < 110; i++) history = committedHistory(history, 'edit', entry)
  expect(history.undo).toHaveLength(100)
})

it('recognizes platform undo/redo shortcuts without taking plain or Alt keystrokes', () => {
  const plain = { key: 'z', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }
  expect(historyShortcut(plain)).toBeUndefined()
  expect(historyShortcut({ ...plain, metaKey: true })).toBe('undo')
  expect(historyShortcut({ ...plain, ctrlKey: true })).toBe('undo')
  expect(historyShortcut({ ...plain, metaKey: true, shiftKey: true })).toBe('redo')
  expect(historyShortcut({ ...plain, ctrlKey: true, key: 'y' })).toBe('redo')
  expect(historyShortcut({ ...plain, ctrlKey: true, altKey: true })).toBeUndefined()
})
