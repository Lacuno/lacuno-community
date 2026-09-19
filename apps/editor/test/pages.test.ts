import { DocumentStore } from '@freeflow/document'
import { fixtureDocument } from '@freeflow/schema'
import { expect, it } from 'vitest'
import { captureEdit, type EditOperation } from '../src/history.js'
import { duplicatePage, pagePathError } from '../src/pages.js'

it('duplicates entire pages with stable undo/redo, independent local styles, and shared components', async () => {
  const original = fixtureDocument()
  const node = original.nodes['n-hero-title']!
  original.classes['c-local-test'] = { id: 'c-local-test', kind: 'local' }
  node.classes.push('c-local-test')
  const store = DocumentStore.inMemory(original)
  const copy = duplicatePage(original, 'p-home')
  const history = captureEdit(original, copy.operations)
  await store.apply({ expectedRevision: store.revision, operations: copy.operations })
  const copied = store.read().document
  expect(copied.pages[copy.id]?.path).toBe('/home-copy')
  expect(
    Object.values(copied.nodes).filter((n) => n.classes.includes('c-local-test')),
  ).toHaveLength(1)
  expect(Object.keys(copied.components)).toEqual(Object.keys(original.components))
  expect(duplicatePage(copied, 'p-home').operations.at(-1)).toMatchObject({ path: '/home-copy-2' })
  await store.apply({ expectedRevision: store.revision, operations: history.undo })
  expect({ ...store.read().document, revision: original.revision }).toEqual(original)
  await store.apply({ expectedRevision: store.revision, operations: history.redo })
  expect({ ...store.read().document, revision: copied.revision }).toEqual(copied)
  const removal = captureEdit(copied, [{ type: 'page.delete', id: copy.id }])
  await store.apply({ expectedRevision: store.revision, operations: removal.redo })
  await store.apply({ expectedRevision: store.revision, operations: removal.undo })
  expect({ ...store.read().document, revision: copied.revision }).toEqual(copied)
})

it('restores names, paths and absent SEO exactly', async () => {
  const original = fixtureDocument()
  delete original.pages['p-home']!.seo
  const operations: EditOperation[] = [
    {
      type: 'page.update',
      id: 'p-home',
      name: 'Start',
      path: '/start',
      seo: { title: 'Start here', description: 'Our site' },
    },
  ]
  const history = captureEdit(original, operations)
  const store = DocumentStore.inMemory(original)
  await store.apply({ expectedRevision: store.revision, operations })
  await store.apply({ expectedRevision: store.revision, operations: history.undo })
  expect({ ...store.read().document, revision: original.revision }).toEqual(original)
})

it('validates path syntax, uniqueness and collection parameters', () => {
  const doc = fixtureDocument()
  expect(pagePathError(doc, '/', 'p-home')).toBe('')
  expect(pagePathError(doc, '/')).toContain('already')
  for (const path of ['/About', '/about/', '/about?x', 'about', '/[slug]'])
    expect(pagePathError(doc, path)).not.toBe('')
  expect(pagePathError(doc, '/company/team')).toBe('')
  expect(pagePathError(doc, '/posts', 'p-post')).toContain('parameter')
  expect(duplicatePage(doc, 'p-post').operations.at(-1)).toMatchObject({ collection: 'col-posts' })
})

it('preserves locked and combo classes when duplicating a page', async () => {
  const doc = fixtureDocument()
  doc.classes['c-locked'] = { id: 'c-locked', kind: 'local', locked: true }
  doc.classes['c-parent'] = { id: 'c-parent', kind: 'local' }
  doc.classes['c-combo'] = { id: 'c-combo', kind: 'local', combo: ['c-parent'] }
  doc.nodes['n-hero-title']!.classes.push('c-locked', 'c-combo', 'c-parent')
  const duplicate = duplicatePage(doc, 'p-home')
  const store = DocumentStore.inMemory(doc)
  await store.apply({ expectedRevision: 0, operations: duplicate.operations })
  for (const id of ['c-locked', 'c-combo', 'c-parent']) {
    expect(
      Object.values(store.read().document.nodes).filter((node) => node.classes.includes(id)),
    ).toHaveLength(2)
    expect(store.read().document.classes[id]).toEqual(doc.classes[id])
  }
})
