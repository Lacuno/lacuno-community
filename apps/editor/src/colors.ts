import type { CssValue, Document } from '@freeflow/schema'
import { designTokenCssName } from '@freeflow/schema'

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

export function referencesColor(value: CssValue, id: string): boolean {
  if (value.type === 'designToken') return value.ref === id
  if (value.type === 'list') return value.values.some((item) => referencesColor(item, id))
  if (value.type === 'fn') return value.args.some((item) => referencesColor(item, id))
  return false
}
