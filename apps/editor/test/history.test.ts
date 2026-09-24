import { DocumentStore } from '@miralo/document'
import { fixtureDocument } from '@miralo/schema'
import { expect, it } from 'vitest'
import {
  committedHistory,
  emptyHistory,
  type HistoryEntry,
  historyShortcut,
} from '../src/history.js'
import { commit } from './helpers.js'

it('keeps rejected undos from overwriting a later revision', async () => {
  const store = DocumentStore.inMemory(fixtureDocument())
  const entry = await commit(store, [
    { type: 'node.update', id: 'n-hero-title', text: { type: 'static', value: 'Mine' } },
  ])
  const revision = store.revision
  await store.apply({
    expectedRevision: revision,
    operations: [
      { type: 'node.update', id: 'n-hero-title', text: { type: 'static', value: 'Someone else' } },
    ],
  })
  const latest = store.read()
  await expect(store.apply({ expectedRevision: revision, patches: entry.undo })).rejects.toThrow(
    'stale revision',
  )
  expect(store.read()).toEqual(latest)
})

it('clears redo after a new edit and bounds history to 100 saved batches', () => {
  const entry: HistoryEntry = {
    undo: [{ op: 'delete', path: ['classes', 'c-new'] }],
    redo: [{ op: 'set', path: ['classes', 'c-new'], value: { id: 'c-new', kind: 'local' } }],
  }
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
