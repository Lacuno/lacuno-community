/** The visual controls only interpret templates they can round-trip without losing CSS. */
export function gridTracks(template: string): number[] | undefined {
  const text = template.trim()
  const repeated = text.match(/^repeat\(\s*(\d+)\s*,\s*(.+)\)$/)
  if (repeated) {
    const count = Number(repeated[1])
    const track = gridTracks(repeated[2]!)
    return count >= 1 && count <= 12 && track?.length === 1
      ? Array.from({ length: count }, () => track[0]!)
      : undefined
  }
  const parts = text.replace(/minmax\(\s*0(?:px)?\s*,\s*([\d.]+fr)\s*\)/g, '$1').split(/\s+/)
  if (parts.length > 12 || !parts.every((part) => /^(?:\d*\.)?\d+fr$/.test(part))) return undefined
  const weights = parts.map((part) => Number(part.match(/([\d.]+)fr/)?.[1]))
  return weights.every((weight) => Number.isFinite(weight) && weight > 0) ? weights : undefined
}

export const gridTemplate = (weights: number[]) =>
  weights.map((weight) => `minmax(0, ${weight}fr)`).join(' ')

export type LayoutMode = 'block' | 'row' | 'stack' | 'grid'
export function layoutMode(display: string, direction: string): LayoutMode | undefined {
  if (display === 'grid' || display === 'inline-grid') return 'grid'
  if (display === 'flex' || display === 'inline-flex')
    return direction.startsWith('column') ? 'stack' : 'row'
  return display === 'block' || !display ? 'block' : undefined
}

export function layoutChanges(mode: LayoutMode, template: string): Record<string, string> {
  if (mode === 'grid')
    return {
      display: 'grid',
      ...(!template || template === 'none'
        ? { 'grid-template-columns': gridTemplate([1, 1, 1]) }
        : {}),
    }
  if (mode === 'row' || mode === 'stack')
    return { display: 'flex', 'flex-direction': mode === 'row' ? 'row' : 'column' }
  return { display: 'block' }
}

export type ItemSize = 'fit' | 'fill' | 'fixed'
export function itemSize(
  width: string,
  grow: string,
  horizontal: boolean,
  stretched = false,
): ItemSize {
  if ((horizontal && Number(grow) > 0) || width === '100%') return 'fill'
  if ((!width || width === 'auto') && stretched) return 'fill'
  if (!width || ['auto', 'fit-content', 'max-content'].includes(width)) return 'fit'
  return 'fixed'
}

export function itemSizeChanges(
  mode: ItemSize,
  horizontal: boolean,
  measured: string,
): Record<string, string> {
  return {
    width:
      mode === 'fixed'
        ? measured || '160px'
        : mode === 'fill'
          ? horizontal
            ? 'auto'
            : '100%'
          : 'fit-content',
    ...(horizontal
      ? {
          'flex-grow': mode === 'fill' ? '1' : '0',
          'flex-shrink': mode === 'fixed' ? '0' : '1',
          'flex-basis': mode === 'fill' ? '0px' : 'auto',
        }
      : {}),
  }
}

/** Properties handled by the layout panel, also registered with formatting for presets/reset. */
export const containerLayoutProperties = [
  'display',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'justify-items',
  'grid-template-columns',
  'grid-template-rows',
  'grid-auto-flow',
  'gap',
  'column-gap',
  'row-gap',
]
