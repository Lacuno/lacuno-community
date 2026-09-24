import type { Operation } from '@miralo/document'
import type { Document } from '@miralo/schema'
import { designTokenCssName } from '@miralo/schema'
import { parseRgb, rgbHex } from './colorWheel.js'

export const colorProperties = new Set(['color', 'background-color', 'border-color'])
export const projectColors = (doc: Document) =>
  Object.values(doc.designTokens)
    .filter((token) => token.group === 'color')
    .sort((a, b) => a.name.localeCompare(b.name))
export const defaultMode = (doc: Document) =>
  (doc.site.modes.find((mode) => mode.default) ?? doc.site.modes[0])!.id
export const colorLabel = (name: string) =>
  name
    .replace(/^color\./, '')
    .split('.')
    .map((part) => part.replace(/-/g, ' ').replace(/^./, (letter) => letter.toUpperCase()))
    .join(' / ')

export function colorTokenName(doc: Document, name: string, family?: string): string {
  const slug = name.trim().toLowerCase().replace(/\s+/g, '-')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error('Use a name with letters, numbers, spaces or hyphens.')
  const result = `${family ?? 'color'}.${slug}`
  if (
    Object.values(doc.designTokens).some(
      (token) => designTokenCssName(token.name) === designTokenCssName(result),
    )
  )
    throw new Error('A color with this name already exists.')
  return result
}

/** The operation that creates a project colour; its id is the new token's. */
export function colorToken(
  doc: Document,
  name: string,
  value: string,
  family?: string,
): Extract<Operation, { type: 'designToken.create' }> & { id: string } {
  return {
    type: 'designToken.create',
    id: `dt-${crypto.randomUUID()}`,
    name: colorTokenName(doc, name, family),
    group: 'color',
    values: { [defaultMode(doc)]: { type: 'color', value } },
  }
}

/** Resolve aliases for swatches without copying them into saved styles. */
export function colorPreview(
  doc: Document,
  id: string,
  mode = defaultMode(doc),
  seen = new Set<string>(),
): string {
  if (seen.has(id)) return ''
  seen.add(id)
  const token = doc.designTokens[id]
  const value = token?.values[mode] ?? token?.values[defaultMode(doc)]
  if (value?.type === 'designToken') return colorPreview(doc, value.ref, mode, seen)
  return value && 'value' in value && typeof value.value === 'string' ? value.value : ''
}

/** `<input type="color">` only accepts #rrggbb, so coerce what the user typed. */
export function pickerHex(value: string, fallback: string): string {
  const parts = parseRgb(value)
  return parts ? rgbHex(parts) : fallback
}
