import { readFileSync } from 'node:fs'
import { type Document, type Font, fixtureDocument } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { FONT_STACKS, faceFromFileName, faceLabel, fontChoices, setFallback } from '../src/fonts.js'

it('prefills family, weight and style from a font file name', () => {
  expect(faceFromFileName('Inter-BoldItalic.woff2')).toEqual({
    family: 'Inter',
    weight: 700,
    style: 'italic',
  })
  expect(faceFromFileName('Open_Sans-SemiBold.ttf')).toEqual({
    family: 'Open Sans',
    weight: 600,
    style: 'normal',
  })
  expect(faceFromFileName('Lora-Italic.otf')).toEqual({
    family: 'Lora',
    weight: 400,
    style: 'italic',
  })
  expect(faceFromFileName('Roboto-Regular.woff')).toMatchObject({ family: 'Roboto', weight: 400 })
  expect(faceFromFileName('Bold.woff2')).toEqual({ family: 'Bold', weight: 400, style: 'normal' })
})

it('prefills a variable face from 100 to 900 when the name says Variable, VF or wght', () => {
  const variable = { weightRange: [100, 900], style: 'normal' }
  expect(faceFromFileName('Outfit-Variable.woff2')).toEqual({ family: 'Outfit', ...variable })
  expect(faceFromFileName('Inter-Variable.woff2')).toEqual({ family: 'Inter', ...variable })
  expect(faceFromFileName('Outfit[wght].ttf')).toEqual({ family: 'Outfit', ...variable })
  expect(faceFromFileName('Recursive_VF.woff2')).toEqual({ family: 'Recursive', ...variable })
  expect(faceFromFileName('outfit-latin-wght-normal.woff2')).toMatchObject(variable)
  expect(faceFromFileName('outfit-latin-wght-italic.woff2')).toMatchObject({
    weightRange: [100, 900],
    style: 'italic',
  })
})

it('lists the template font, then the built-in stacks', () => {
  const template = JSON.parse(
    readFileSync(new URL('../../../templates/lacuno/lacuno.json', import.meta.url), 'utf8'),
  ) as Document
  expect(fontChoices(template)).toEqual([
    'Arial, Helvetica, sans-serif',
    'system-ui, sans-serif',
    'Georgia, serif',
    'ui-monospace, monospace',
  ])
})

it('lists each family once, with its first face fallback, in first-seen order', () => {
  const doc = fixtureDocument()
  doc.site.fonts.push({ family: 'Lora', source: 'system' })
  expect(fontChoices(doc)).toEqual([
    'system-ui, sans-serif',
    '"Fixture Sans", sans-serif',
    'Lora, sans-serif',
    'Georgia, serif',
    'ui-monospace, monospace',
  ])
})

it('sets a family fallback on every face, and removing the last face leaves no fallback', () => {
  const fonts: Font[] = [
    { family: 'A', source: 'asset', asset: 'a-1', fallback: 'serif' },
    { family: 'A', source: 'asset', asset: 'a-2', weight: 700, fallback: 'serif' },
    { family: 'B', source: 'system', fallback: 'serif' },
  ]
  const next = setFallback(fonts, 'A', 'Georgia, serif')
  expect(next.map((f) => f.fallback)).toEqual(['Georgia, serif', 'Georgia, serif', 'serif'])
  expect(setFallback(fonts, 'B', '')[2]!.fallback).toBeUndefined()
  // The fallback lives on each face, so the family and its fallback go with its last face.
  const doc = fixtureDocument()
  doc.site.fonts = fonts.filter((f) => f.family !== 'A')
  expect(fontChoices(doc)).toEqual(['B, serif', ...FONT_STACKS])
})

it('labels a face by weight and style', () => {
  const face = (weight?: number, style?: 'italic'): Font => ({
    family: 'F',
    source: 'asset',
    asset: 'a',
    ...(weight ? { weight } : {}),
    ...(style ? { style } : {}),
  })
  expect(faceLabel(face())).toBe('Regular')
  expect(faceLabel(face(700))).toBe('Bold')
  expect(faceLabel(face(700, 'italic'))).toBe('Bold Italic')
  expect(faceLabel(face(400, 'italic'))).toBe('Italic')
  expect(faceLabel(face(200))).toBe('Extra Light')
  expect(faceLabel({ family: 'F', source: 'system' })).toBe('System')
  const variable: Font = { family: 'F', source: 'asset', asset: 'a', weightRange: [100, 900] }
  expect(faceLabel(variable)).toBe('Variable')
  expect(faceLabel({ ...variable, style: 'italic' })).toBe('Variable Italic')
})
