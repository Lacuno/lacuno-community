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
