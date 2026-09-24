import { DocumentStore } from '@miralo/document'
import { type CssValue, fixtureDocument, rem, styleKey } from '@miralo/schema'
import { expect, it } from 'vitest'
import { editingBreakpoint } from '../src/breakpoints.js'
import {
  formattingOperations,
  localClass,
  localValue,
  normalizeFormatting,
} from '../src/formatting.js'
import { presetValues } from '../src/presets.js'
import { tokenValue } from '../src/tokens.js'
import { commit } from './helpers.js'

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
  const store = DocumentStore.inMemory(doc)
  const entry = await commit(store, operations)
  const edited = store.read().document
  expect(localClass(edited, edited.nodes[node.id]!)).toBe('c-direct')
  for (const [key, style] of Object.entries(original.styles))
    expect(edited.styles[key]).toEqual(style)
  for (const other of Object.values(original.nodes).filter((item) => item.id !== node.id))
    expect(edited.nodes[other.id]).toEqual(other)
  await store.apply({ expectedRevision: store.revision, patches: entry.undo })
  expect({ ...store.read().document, revision: original.revision }).toEqual(original)
  await store.apply({ expectedRevision: store.revision, patches: entry.redo })
  expect({ ...store.read().document, revision: edited.revision }).toEqual(edited)
  const reset = formattingOperations(edited, edited.nodes[node.id]!, { 'font-size': null })
  const resetHistory = await commit(store, reset)
  expect(
    Object.values(store.read().document.styles).some((style) => style.class === 'c-direct'),
  ).toBe(false)
  await store.apply({ expectedRevision: store.revision, patches: resetHistory.undo })
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

it('accepts pixel sizes without requiring CSS units and keeps any other unit or keyword', () => {
  expect(
    normalizeFormatting({
      'font-size': { type: 'raw', value: '24' },
      'line-height': { type: 'raw', value: '1.5' },
      'padding-top': { type: 'raw', value: '1.5rem' },
      'margin-left': { type: 'raw', value: 'auto' },
    }),
  ).toEqual({
    'font-size': { type: 'unit', value: 24, unit: 'px' },
    'line-height': { type: 'raw', value: '1.5' },
    'padding-top': { type: 'raw', value: '1.5rem' },
    'margin-left': { type: 'raw', value: 'auto' },
  })
})

it('writes a picked token as a reference and a detached one as its default-mode value', () => {
  const doc = fixtureDocument()
  const node = doc.nodes['n-hero-title']!
  const reference = { type: 'designToken' as const, ref: 't-space-md' }
  expect(normalizeFormatting({ 'padding-top': reference })).toEqual({ 'padding-top': reference })
  const write = (value: CssValue) =>
    formattingOperations(doc, node, { 'padding-top': value }, () => 'c-token').find(
      (operation) => operation.type === 'style.set' && operation.property === 'padding-top',
    )
  expect(write(reference)).toMatchObject({ value: reference })
  expect(write(tokenValue(doc, doc.designTokens['t-space-md']!))).toMatchObject({ value: rem(1) })
})

it('writes, reads and clears declarations at a state and falls back in specificity order', async () => {
  const doc = fixtureDocument()
  const node = doc.nodes['n-hero-title']!
  const store = DocumentStore.inMemory(doc)
  const get = () => store.read().document
  const apply = async (operations: ReturnType<typeof formattingOperations>) =>
    store.apply({ expectedRevision: store.revision, operations })
  await apply(
    formattingOperations(
      get(),
      get().nodes[node.id]!,
      { 'background-color': { type: 'color', value: '#f00' } },
      () => 'c-state',
      'base',
      'hover',
    ),
  )
  const local = localClass(get(), get().nodes[node.id]!)!
  expect(
    get().styles[
      styleKey({ class: local, breakpoint: 'base', state: 'hover', property: 'background-color' })
    ]?.value,
  ).toEqual({ type: 'color', value: '#f00' })
  expect(localValue(get(), get().nodes[node.id]!, 'background-color', 'base', 'hover')).toEqual({
    type: 'color',
    value: '#f00',
  })
  expect(localValue(get(), get().nodes[node.id]!, 'background-color')).toBeUndefined()
  // A base-state value at the edited breakpoint is the last resort; the state rule outranks it.
  const mobile = editingBreakpoint(get(), 390)
  await apply(
    formattingOperations(
      get(),
      get().nodes[node.id]!,
      { 'background-color': { type: 'color', value: '#00f' } },
      undefined,
      mobile,
    ),
  )
  expect(presetValues(get(), get().nodes[node.id]!, {}, mobile)['background-color']).toEqual({
    type: 'color',
    value: '#00f',
  })
  expect(
    presetValues(get(), get().nodes[node.id]!, {}, mobile, 'hover')['background-color'],
  ).toEqual({
    type: 'color',
    value: '#f00',
  })
  await apply(
    formattingOperations(
      get(),
      get().nodes[node.id]!,
      { 'background-color': null },
      undefined,
      'base',
      'hover',
    ),
  )
  expect(
    localValue(get(), get().nodes[node.id]!, 'background-color', 'base', 'hover'),
  ).toBeUndefined()
})
