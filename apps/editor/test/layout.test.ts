import { generateStylesheet } from '@lacuno/css'
import { DocumentStore } from '@lacuno/document'
import { fixtureDocument } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { formattingOperations, normalizeFormatting } from '../src/formatting.js'
import { gridTemplate, gridTracks, itemSizeChanges, layoutChanges } from '../src/layout.js'
import { presetValues } from '../src/presets.js'
import { commit } from './helpers.js'

it('round-trips proportional grids and leaves arbitrary CSS templates uninterpreted', () => {
  for (const weights of [[1], [1, 2], [1, 1, 1], [0.5, 1.5, 3]])
    expect(gridTracks(gridTemplate(weights))).toEqual(weights)
  expect(gridTracks('repeat(3, minmax(0, 1fr))')).toEqual([1, 1, 1])
  expect(gridTracks('1fr 2fr')).toEqual([1, 2])
  for (const template of [
    'repeat(auto-fit, minmax(200px, 1fr))',
    '200px 1fr',
    '[start] 1fr [end]',
    'minmax(10rem, 1fr) 2fr',
    'subgrid',
    'none',
    'repeat(999, 1fr)',
    '0fr',
  ])
    expect(gridTracks(template)).toBeUndefined()
  expect(layoutChanges('grid', '200px 1fr')).toEqual({ display: 'grid' })
})

it('changes layout at one breakpoint as one undoable batch, preserving children and desktop', async () => {
  const doc = fixtureDocument()
  const node = doc.nodes['n-hero'] ?? Object.values(doc.nodes).find((n) => n.children.length)!
  const mobile = Object.keys(doc.breakpoints).find((id) => id !== 'base')!
  const raw = (values: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(values).map(([p, v]) => [p, { type: 'raw' as const, value: v }]),
    )
  const store = DocumentStore.inMemory(doc)
  await commit(
    store,
    formattingOperations(
      doc,
      node,
      raw({ display: 'grid', 'grid-template-columns': gridTemplate([1, 2]) }),
    ),
  )
  const before = store.read().document
  const entry = await commit(
    store,
    formattingOperations(
      before,
      before.nodes[node.id]!,
      raw(layoutChanges('stack', '')),
      undefined,
      mobile,
    ),
  )
  const updated = store.read().document
  expect(presetValues(updated, updated.nodes[node.id]!, {}, 'base').display).toEqual({
    type: 'raw',
    value: 'grid',
  })
  expect(presetValues(updated, updated.nodes[node.id]!, {}, mobile).display).toEqual({
    type: 'raw',
    value: 'flex',
  })
  expect(updated.nodes[node.id]!.children).toEqual(node.children)
  await store.apply({ expectedRevision: store.revision, patches: entry.undo })
  expect(
    presetValues(store.read().document, store.read().document.nodes[node.id]!, {}, mobile).display,
  ).toEqual({ type: 'raw', value: 'grid' })
})

it('normalizes axis gaps, includes them in presets, and emits them after the gap shorthand', async () => {
  const doc = fixtureDocument(),
    node = Object.values(doc.nodes).find((n) => n.children.length)!
  const store = DocumentStore.inMemory(doc)
  const changes = normalizeFormatting({
    gap: { type: 'raw', value: '12' },
    'column-gap': { type: 'raw', value: '24' },
    'row-gap': { type: 'raw', value: '32' },
  })
  await commit(store, formattingOperations(doc, node, changes))
  const updated = store.read().document
  expect(presetValues(updated, updated.nodes[node.id]!, {})['column-gap']).toEqual({
    type: 'unit',
    value: 24,
    unit: 'px',
  })
  expect(generateStylesheet(updated).css).toMatch(/gap: 12px;\s+row-gap: 32px;\s+column-gap: 24px;/)
})

it('fills a row using flex growth and fixes its width without shrink', () => {
  expect(itemSizeChanges('fill', true, '100px')).toMatchObject({
    width: 'auto',
    'flex-grow': '1',
    'flex-basis': '0px',
  })
  expect(itemSizeChanges('fixed', true, '152px')).toMatchObject({
    width: '152px',
    'flex-grow': '0',
    'flex-shrink': '0',
  })
  expect(itemSizeChanges('fill', false, '100px')).toEqual({ width: '100%' })
})
