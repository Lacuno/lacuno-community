import { DocumentStore } from '@miralo/document'
import { fixtureDocument, styleKey } from '@miralo/schema'
import { expect, it } from 'vitest'
import { breakpointMedia, editingBreakpoint } from '../src/breakpoints.js'
import { formattingOperations, localValue } from '../src/formatting.js'
import { applyPreset, createPreset, presetValues, updatePreset } from '../src/presets.js'
import { commit } from './helpers.js'

it('writes and resets only the selected breakpoint and round-trips undo', async () => {
  const doc = fixtureDocument()
  const node = doc.nodes['n-hero-title']!
  const mobile = editingBreakpoint(doc, 390)
  expect(mobile).not.toBe('base')
  expect(breakpointMedia(doc, mobile)).toContain('max-width')
  const store = DocumentStore.inMemory(doc)
  const apply = async (ops: ReturnType<typeof formattingOperations>) =>
    store.apply({ expectedRevision: store.revision, operations: ops })
  await apply(
    formattingOperations(doc, node, { 'font-size': { type: 'unit', value: 60, unit: 'px' } }),
  )
  let current = store.read().document
  await apply(
    formattingOperations(
      current,
      current.nodes[node.id]!,
      { 'font-size': { type: 'unit', value: 24, unit: 'px' } },
      undefined,
      mobile,
    ),
  )
  current = store.read().document
  expect(localValue(current, current.nodes[node.id]!, 'font-size')).toEqual({
    type: 'unit',
    value: 60,
    unit: 'px',
  })
  expect(localValue(current, current.nodes[node.id]!, 'font-size', mobile)).toEqual({
    type: 'unit',
    value: 24,
    unit: 'px',
  })
  const reset = formattingOperations(
    current,
    current.nodes[node.id]!,
    { 'font-size': null },
    undefined,
    mobile,
  )
  const entry = await commit(store, reset)
  expect(
    presetValues(store.read().document, store.read().document.nodes[node.id]!, {}, mobile)[
      'font-size'
    ],
  ).toEqual({ type: 'unit', value: 60, unit: 'px' })
  await store.apply({ expectedRevision: store.revision, patches: entry.undo })
  expect(
    localValue(store.read().document, store.read().document.nodes[node.id]!, 'font-size', mobile),
  ).toEqual({ type: 'unit', value: 24, unit: 'px' })
})

it('captures responsive presets and updates only their current breakpoint', async () => {
  const doc = fixtureDocument()
  const node = doc.nodes['n-hero-title']!
  const mobile = editingBreakpoint(doc, 390)
  const store = DocumentStore.inMemory(doc)
  const get = () => store.read().document
  const apply = async (operations: ReturnType<typeof formattingOperations>) =>
    store.apply({ expectedRevision: store.revision, operations })
  await apply(
    formattingOperations(get(), get().nodes[node.id]!, {
      'font-size': { type: 'unit', value: 60, unit: 'px' },
    }),
  )
  await apply(
    formattingOperations(
      get(),
      get().nodes[node.id]!,
      { 'font-size': { type: 'unit', value: 24, unit: 'px' } },
      undefined,
      mobile,
    ),
  )
  await apply(
    createPreset(get(), get().nodes[node.id]!, 'Responsive heading', {}, 'c-responsive', mobile),
  )
  const key = (breakpoint: string) =>
    styleKey({ class: 'c-responsive', breakpoint, state: 'none', property: 'font-size' })
  expect(get().styles[key('base')]?.value).toEqual({ type: 'unit', value: 60, unit: 'px' })
  expect(get().styles[key(mobile)]?.value).toEqual({ type: 'unit', value: 24, unit: 'px' })
  expect(localValue(get(), get().nodes[node.id]!, 'font-size', mobile)).toBeUndefined()
  await apply(
    formattingOperations(
      get(),
      get().nodes[node.id]!,
      { 'font-size': { type: 'unit', value: 28, unit: 'px' } },
      undefined,
      mobile,
    ),
  )
  await apply(updatePreset(get(), get().nodes[node.id]!, mobile))
  expect(get().styles[key('base')]?.value).toEqual({ type: 'unit', value: 60, unit: 'px' })
  expect(get().styles[key(mobile)]?.value).toEqual({ type: 'unit', value: 28, unit: 'px' })
  await apply(applyPreset(get(), get().nodes[node.id]!, 'c-responsive'))
  expect(presetValues(get(), get().nodes[node.id]!, {}, mobile)['font-size']).toEqual({
    type: 'unit',
    value: 28,
    unit: 'px',
  })
})
