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

type RichNode = { type?: unknown; attrs?: Record<string, unknown>; content?: unknown }

/** What each table part holds. */
const TABLE_PARTS: Record<string, string[]> = {
  table: ['tableRow'],
  tableRow: ['tableCell', 'tableHeader'],
}
const children = (node: RichNode) =>
  Array.isArray(node.content) ? (node.content as RichNode[]) : []

/**
 * Why a rich text's tables are malformed, or nothing: a table holds rows, a row holds cells, a cell
 * holds blocks but no table, and every row spans as many columns once spans are counted.
 */
export function tableProblem(node: RichNode, parent = 'doc', inCell = false): string | undefined {
  const type = String(node.type)
  const cell = type === 'tableCell' || type === 'tableHeader'
  const allowed = TABLE_PARTS[parent]
  if (allowed && !allowed.includes(type)) return `a ${parent} holds only ${allowed.join(' or ')}`
  if (!allowed && (cell || type === 'tableRow')) return `a ${type} must sit in a table`
  if (type === 'table' && inCell) return 'a table cannot sit inside a table'
  if ((cell || TABLE_PARTS[type]) && !children(node).length) return `a ${type} cannot be empty`
  for (const span of ['colspan', 'rowspan']) {
    const value = node.attrs?.[span]
    if (cell && value != null && !(Number.isInteger(value) && (value as number) >= 1))
      return `${span} must be a whole number of at least 1`
  }
  if (type === 'table') {
    // The columns each row fills, including those a cell above fills by spanning down.
    const rows = children(node)
    const filled = rows.map(() => new Set<number>())
    for (const [r, row] of rows.entries())
      for (const { attrs } of children(row)) {
        const colspan = Number(attrs?.colspan ?? 1)
        const rowspan = Number(attrs?.rowspan ?? 1)
        if (r + rowspan > rows.length) return 'a cell spans past the last row'
        let column = 0
        while (filled[r]!.has(column)) column++
        for (let down = r; down < r + rowspan; down++)
          for (let across = column; across < column + colspan; across++) filled[down]!.add(across)
      }
    if (filled.some((row) => row.size !== filled[0]!.size))
      return 'every row of a table needs the same number of columns'
  }
  for (const child of children(node)) {
    const problem = tableProblem(child, type, inCell || cell)
    if (problem) return problem
  }
}
