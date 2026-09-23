import type { Document, Font } from '@freeflow/schema'

/** Weight names from 100 to 900, as font files spell them without the spaces. */
export const WEIGHT_NAMES = [
  'Thin',
  'Extra Light',
  'Light',
  'Regular',
  'Medium',
  'Semi Bold',
  'Bold',
  'Extra Bold',
  'Black',
]

/** Stacks every site offers after its own families; they need no file. */
export const FONT_STACKS = ['system-ui, sans-serif', 'Georgia, serif', 'ui-monospace, monospace']

/** Prefills a face from a file name: `Inter-BoldItalic.woff2` is Inter, 700, italic. */
export function faceFromFileName(name: string) {
  const stem = name.replace(/\.[^.]*$/, '')
  const cut = Math.max(stem.lastIndexOf('-'), stem.lastIndexOf('_'))
  const suffix = stem.slice(cut + 1).toLowerCase()
  const italic = suffix.endsWith('italic')
  const weightName = (italic ? suffix.slice(0, -'italic'.length) : suffix) || 'regular'
  const index = WEIGHT_NAMES.findIndex((n) => n.replace(' ', '').toLowerCase() === weightName)
  const known = cut > 0 && index >= 0
  return {
    family: (known ? stem.slice(0, cut) : stem).replace(/[-_]+/g, ' ').trim(),
    weight: known ? (index + 1) * 100 : 400,
    style: known && italic ? ('italic' as const) : ('normal' as const),
  }
}

/** The font-family value the editor writes for a family: the name, quoted unless it is a plain
 * identifier, then its fallback. */
export const fontValue = ({ family, fallback }: Font) =>
  `${/^[A-Za-z_-][\w-]*$/.test(family) ? family : `"${family}"`}, ${fallback ?? 'sans-serif'}`

/** The site's families in first-seen order, each with its first face's fallback, then the stacks. */
export const fontChoices = ({ site: { fonts } }: Document) => [
  ...new Set([
    ...fonts.filter((f, i) => fonts.findIndex((g) => g.family === f.family) === i).map(fontValue),
    ...FONT_STACKS,
  ]),
]

/** Sets the fallback on every face of a family; an empty fallback is removed. */
export const setFallback = (fonts: Font[], family: string, fallback: string) =>
  fonts.map((font) =>
    font.family === family ? { ...font, fallback: fallback || undefined } : font,
  )

/** "Regular", "Bold", "Bold Italic", "Italic"; a system font is "System". */
export function faceLabel(font: Font) {
  if (font.source === 'system') return 'System'
  const weight = WEIGHT_NAMES[(font.weight ?? 400) / 100 - 1]!
  if (font.style !== 'italic') return weight
  return weight === 'Regular' ? 'Italic' : `${weight} Italic`
}
