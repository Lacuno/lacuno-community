import { DocumentStore } from '@lacuno/document'
import { fixtureDocument, px } from '@lacuno/schema'
import { expect, it } from 'vitest'
import {
  isRichBlock,
  richClass,
  richClassName,
  tagStyleOperations,
  tagValue,
} from '../src/richTags.js'
import { commit } from './helpers.js'

it('styles a tag on the block class, creating a preset named after the page when there is none', async () => {
  const doc = fixtureDocument()
  const body = doc.nodes['n-post-body']!
  expect(isRichBlock(doc, body)).toBe(true)
  expect(isRichBlock(doc, doc.nodes['n-post-title']!)).toBe(false)
  expect(richClass(doc, body)).toBeUndefined()
  expect(richClassName(doc, body)).toBe('Post rich text')
  // Nothing to set, nothing to create.
  expect(
    tagStyleOperations(doc, body, 'h2', { color: null }, 'base', 'none', () => 'c-new'),
  ).toEqual([])
  const store = DocumentStore.inMemory(doc)
  await commit(
    store,
    tagStyleOperations(doc, body, 'h2', { 'font-size': px(22) }, 'base', 'none', () => 'c-new'),
  )
  const after = store.read().document
  expect(after.classes['c-new']).toEqual({
    id: 'c-new',
    kind: 'class',
    name: 'Post rich text',
    preset: true,
  })
  expect(after.nodes['n-post-body']!.classes).toEqual(['c-new'])
  expect(tagValue(after, after.nodes['n-post-body']!, 'h2', 'font-size', 'base', 'none')).toEqual(
    px(22),
  )
  // The next rule and a clear land on the same class, and the block's own formatting is untouched.
  const node = after.nodes['n-post-body']!
  await commit(store, [
    ...tagStyleOperations(after, node, 'a', { color: px(1) }, 'base', 'hover', () => 'c-other'),
    ...tagStyleOperations(
      after,
      node,
      'h2',
      { 'font-size': null },
      'base',
      'none',
      () => 'c-other',
    ),
  ])
  const styles = store.read().document.styles
  expect(Object.keys(styles).filter((key) => key.startsWith('c-new|'))).toEqual([
    'c-new|a|base|hover|color',
  ])
})
