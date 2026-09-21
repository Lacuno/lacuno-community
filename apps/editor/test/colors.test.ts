import { DocumentStore, type Operation } from '@freeflow/document'
import { fixtureDocument, styleKey } from '@freeflow/schema'
import { expect, it } from 'vitest'
import { colorLabel, colorPreview, colorTokenName, defaultMode, pickerHex } from '../src/colors.js'
import { commit } from './helpers.js'

it('round-trips classes, color variants and shared typed references in one saved batch', async () => {
  const original = fixtureDocument()
  const mode = defaultMode(original)
  const coordinates = {
    class: 'c-new-color',
    breakpoint: 'base',
    state: 'none' as const,
    property: 'color',
  }
  const operations: Operation[] = [
    { type: 'class.create', id: 'c-new-color', name: 'shared-color' },
    {
      type: 'node.update',
      id: 'n-hero-title',
      classes: [...original.nodes['n-hero-title']!.classes, 'c-new-color'],
    },
    {
      type: 'designToken.create',
      id: 'dt-new-color',
      name: 'color.new',
      group: 'color',
      values: { [mode]: { type: 'color', value: '#123456' } },
    },
    {
      type: 'designToken.create',
      id: 'dt-new-light',
      name: 'color.new.light',
      group: 'color',
      values: { [mode]: { type: 'color', value: '#abcdef' } },
    },
    {
      type: 'style.set',
      ...coordinates,
      value: { type: 'designToken', ref: 'dt-new-light' },
      important: true,
    },
    {
      type: 'designToken.setValue',
      id: 'dt-new-light',
      mode,
      value: { type: 'color', value: '#fedcba' },
    },
  ]
  const store = DocumentStore.inMemory(original)
  const entry = await commit(store, operations)
  const edited = store.read().document
  expect(edited.styles[styleKey(coordinates)]!.value).toEqual({
    type: 'designToken',
    ref: 'dt-new-light',
  })
  expect(colorPreview(edited, 'dt-new-light')).toBe('#fedcba')
  await store.apply({ expectedRevision: store.revision, patches: entry.undo })
  expect({ ...store.read().document, revision: original.revision }).toEqual(original)
  await store.apply({ expectedRevision: store.revision, patches: entry.redo })
  expect({ ...store.read().document, revision: edited.revision }).toEqual(edited)
})

it('restores missing mode overrides and preserves aliases', async () => {
  const doc = fixtureDocument()
  const mode = defaultMode(doc)
  doc.site.modes.push({ id: 'test-mode', label: 'Test mode', selector: '.test-mode' })
  doc.designTokens['dt-test'] = {
    id: 'dt-test',
    name: 'color.test',
    group: 'color',
    values: { [mode]: { type: 'color', value: '#123456' } },
  }
  doc.designTokens['dt-alias'] = {
    id: 'dt-alias',
    name: 'color.alias',
    group: 'color',
    values: { [mode]: { type: 'designToken', ref: 'dt-test' } },
  }
  expect(colorPreview(doc, 'dt-alias', 'test-mode')).toBe('#123456')
  const operations: Operation[] = [
    {
      type: 'designToken.setValue',
      id: 'dt-alias',
      mode: 'test-mode',
      value: { type: 'color', value: '#ffffff' },
    },
  ]
  const store = DocumentStore.inMemory(doc)
  const entry = await commit(store, operations)
  await store.apply({ expectedRevision: store.revision, patches: entry.undo })
  expect({ ...store.read().document, revision: doc.revision }).toEqual(doc)
})

it('normalizes labels, rejects duplicate CSS names, and coerces picker values', () => {
  const doc = fixtureDocument()
  expect(colorTokenName(doc, 'Ocean Blue')).toBe('color.ocean-blue')
  expect(colorTokenName(doc, 'Muted', 'color.ocean-blue')).toBe('color.ocean-blue.muted')
  expect(colorLabel('color.ocean-blue.muted')).toBe('Ocean blue / Muted')
  expect(() => colorTokenName(doc, 'bad;name')).toThrow('name')
  doc.designTokens['dt-clash'] = {
    id: 'dt-clash',
    name: 'color.ocean.blue',
    group: 'color',
    values: {},
  }
  expect(() => colorTokenName(doc, 'Ocean Blue')).toThrow('already exists')
  expect(pickerHex('#123456ff', '#6952d9')).toBe('#123456')
  expect(pickerHex('rgb(105, 82, 217)', '#000000')).toBe('#6952d9')
  expect(pickerHex('rebeccapurple', '#000000')).toBe('#000000')
})
