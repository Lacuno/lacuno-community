export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

export type AttrMap = Record<string, string | true>

/** Attributes sorted by name so output is deterministic. `true` renders a bare attribute. */
export function renderAttrs(attrs: AttrMap): string {
  return Object.keys(attrs)
    .sort()
    .map((k) => {
      const v = attrs[k]
      return v === true ? ` ${k}` : ` ${k}="${escapeAttr(v as string)}"`
    })
    .join('')
}

export const VOID_TAGS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])

export type Warn = (message: string) => void
