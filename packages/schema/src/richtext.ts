/** Inline style contract shared by the editor and renderer: accepted values must survive saving. */
export const textStyleProperties = {
  fontFamily: 'font-family',
  fontWeight: 'font-weight',
  fontStyle: 'font-style',
  color: 'color',
  fontSize: 'font-size',
} as const

export function safeTextStyleValue(attribute: string, value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const text = value.trim()
  const patterns: Record<string, RegExp> = {
    fontFamily: /^[\w\s,"'-]+$/,
    fontWeight: /^[1-9]00$/,
    fontStyle: /^(normal|italic)$/,
    color: /^(#[\da-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d\s.,%/+-]+\))$/i,
    fontSize: /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|em|rem|%)$/,
  }
  return Object.hasOwn(patterns, attribute) && patterns[attribute]!.test(text) ? text : undefined
}

/** Link destinations accepted by both the visual editor and static renderer. */
export function safeLinkHref(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  const href = value.trim()
  if (
    !href ||
    [...href].some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === '\\',
    )
  )
    return
  if (/^(https?:\/\/|mailto:|tel:)/i.test(href) || /^(\/(?!\/)|#)/.test(href)) return href
}

/** Rich text as plain text: inline content joined, blocks separated by a space. */
export function plainText(n: unknown): string {
  const o = n as { type?: string; text?: string; content?: unknown[] }
  if (typeof o.text === 'string') return o.text
  const inline = o.type === 'paragraph' || o.type === 'heading' || o.type === 'codeBlock'
  return (o.content ?? []).map(plainText).join(inline ? '' : ' ')
}
