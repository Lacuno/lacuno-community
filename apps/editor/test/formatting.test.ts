import { DocumentStore } from '@freeflow/document'
import { type CssValue, fixtureDocument, rem, styleKey } from '@freeflow/schema'
import { expect, it } from 'vitest'
import { editingBreakpoint } from '../src/breakpoints.js'
import {
  formattingOperations,
  localClass,
  localValue,
  normalizeFormatting,
} from '../src/formatting.js'
import { presetValues, sourceLabel, sourceTarget, styleSource } from '../src/presets.js'
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

it('names the source of each style: local by scope, class, preset, token, ancestor or default', () => {
  const doc = fixtureDocument()
  const title = doc.nodes['n-hero-title']!
  const cta = doc.nodes['n-hero-cta']!
  const full = (
    node = title,
    property: string,
    breakpoint = 'base',
    state: 'none' | 'hover' = 'none',
    changes = {},
    computed?: string,
  ) =>
    sourceLabel(
      doc,
      styleSource(doc, node, property, breakpoint, state, changes),
      breakpoint,
      state,
      computed,
      property,
    )
  const label = (...args: Parameters<typeof full>) => full(...args).text
  expect(label(title, 'letter-spacing')).toBe('-0.02em · local')
  expect(label(title, 'letter-spacing', 'tablet')).toBe('-0.02em · local, Desktop')
  expect(label(title, 'letter-spacing', 'base', 'hover')).toBe('-0.02em · local, base state')
  expect(label(title, 'font-size')).toBe('clamp(2rem, 5vw, 4rem) · class heading')
  expect(label(cta, 'background-color', 'base', 'hover')).toBe('brand.hover · class primary')
  expect(label(cta, 'background-color', 'tablet')).toBe('brand · class primary, Desktop')
  expect(label(cta, 'padding-top')).toBe('var(--space-sm) var(--space-md) · class button')
  expect(label(cta, 'padding-top', 'base', 'none', {}, '8px')).toBe('8px · class button')
  expect(styleSource(doc, title, 'font-family')).toMatchObject({
    kind: 'inherited',
    from: 'n-home',
  })
  expect(label(title, 'font-family')).toBe('body · inherited')
  expect(full(title, 'font-family').title).toBe('body · inherited from Body (class page)')
  expect(label(title, 'width')).toBe('default')
  expect(label(title, 'font-weight', 'base', 'none', {}, '700')).toBe('Bold · default')
  expect(label(title, 'text-align', 'tablet')).toBe('default')
  expect(label(title, 'font-family', 'base', 'none', { 'font-family': rem(1) })).toBe(
    '1rem · local',
  )
  expect(label(title, 'letter-spacing', 'base', 'none', { 'letter-spacing': null })).toBe(
    '-0.02em · local',
  )
  doc.classes['c-heading']!.preset = true
  expect(label(title, 'font-size')).toBe('clamp(2rem, 5vw, 4rem) · preset heading')
})

it('makes a source line lead to the ancestor, class, preset or token it names', () => {
  const doc = fixtureDocument()
  const title = doc.nodes['n-hero-title']!
  const cta = doc.nodes['n-hero-cta']!
  const target = (node = title, property: string, changes = {}) =>
    sourceTarget(doc, styleSource(doc, node, property, 'base', 'none', changes))
  expect(target(title, 'font-family')).toEqual({ to: 'element', id: 'n-home', label: 'Go to Body' })
  expect(target(cta, 'padding-top')).toEqual({
    to: 'class',
    id: 'c-button',
    label: 'Go to class button',
  })
  expect(target(title, 'letter-spacing')).toBeUndefined()
  expect(target(title, 'width')).toBeUndefined()
  expect(target(title, 'color', { color: { type: 'designToken', ref: 't-fg' } })).toEqual({
    to: 'token',
    id: 't-fg',
    label: 'Go to token fg',
  })
  doc.classes['c-heading']!.preset = true
  expect(target(title, 'font-size')).toEqual({
    to: 'preset',
    id: 'c-heading',
    label: 'Go to preset heading',
  })
})
