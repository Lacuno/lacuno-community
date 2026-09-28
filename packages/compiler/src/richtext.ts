import {
  type Document,
  type FieldToken,
  type RichText,
  safeLinkHref,
  safeTextStyleValue,
  textStyleProperties,
} from '@lacuno/schema'
import { escapeAttr, escapeHtml, type OnWarn } from './html.js'

type PmNode = {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type?: string; attrs?: Record<string, unknown> }[]
  content?: PmNode[]
}

/** The text of a field shown inside a text, `{Author}`; left out, such a field is unknown. */
export type FieldText = (token: FieldToken) => string

const BLOCK_TAGS: Record<string, string> = {
  paragraph: 'p',
  blockquote: 'blockquote',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
}

function renderMarks(
  text: string,
  marks: PmNode['marks'],
  warn: OnWarn,
  pages?: Document['pages'],
): string {
  let out = text
  // Innermost mark first so the first mark in the array ends up outermost.
  for (const mark of [...(marks ?? [])].reverse()) {
    switch (mark.type) {
      case 'bold':
        out = `<strong>${out}</strong>`
        break
      case 'italic':
        out = `<em>${out}</em>`
        break
      case 'code':
        out = `<code>${out}</code>`
        break
      case 'underline':
        out = `<u>${out}</u>`
        break
      case 'strike':
        out = `<s>${out}</s>`
        break
      case 'link': {
        const pageId = mark.attrs?.pageId
        const destination = typeof pageId === 'string' ? pages?.[pageId]?.path : mark.attrs?.href
        const href = safeLinkHref(destination)
        if (!href) {
          warn('unavailable or unsafe rich text link')
          break
        }
        const target = mark.attrs?.target
          ? ` target="${escapeAttr(String(mark.attrs.target))}"`
          : ''
        const rel = target ? ' rel="noopener"' : ''
        out = `<a href="${escapeAttr(href)}"${target}${rel}>${out}</a>`
        break
      }
      case 'textStyle': {
        const styles: string[] = []
        for (const [attribute, property] of Object.entries(textStyleProperties)) {
          const value = safeTextStyleValue(attribute, mark.attrs?.[attribute])
          if (value) styles.push(`${property}:${value}`)
        }
        if (styles.length) out = `<span style="${escapeAttr(styles.join(';'))}">${out}</span>`
        break
      }
      default:
        warn(`unknown rich text mark ${mark.type}`)
    }
  }
  return out
}

function renderProseChildren(
  node: PmNode,
  warn: OnWarn,
  pages?: Document['pages'],
  field?: FieldText,
): string {
  return (node.content ?? []).map((c) => renderProseNode(c, warn, pages, field)).join('')
}

function renderProseNode(
  node: PmNode,
  warn: OnWarn,
  pages?: Document['pages'],
  field?: FieldText,
): string {
  switch (node.type) {
    case 'text':
      return renderMarks(escapeHtml(node.text ?? ''), node.marks, warn, pages)
    case 'field':
      if (field)
        return renderMarks(escapeHtml(field(node.attrs as FieldToken)), node.marks, warn, pages)
      warn('a field inside text is only shown in a text on a page')
      return ''
    case 'hardBreak':
      return '<br>'
    case 'horizontalRule':
      return '<hr>'
    case 'heading': {
      const raw = Number(node.attrs?.level)
      const level = Number.isFinite(raw) ? Math.min(6, Math.max(1, Math.trunc(raw))) : 2
      return `<h${level}>${renderProseChildren(node, warn, pages, field)}</h${level}>`
    }
    case 'codeBlock':
      return `<pre><code>${renderProseChildren(node, warn, pages, field)}</code></pre>`
    case 'table':
      return renderTable(node, warn, pages, field)
    default: {
      const tag = node.type ? BLOCK_TAGS[node.type] : undefined
      if (tag) return `<${tag}>${renderProseChildren(node, warn, pages, field)}</${tag}>`
      warn(`unknown rich text node ${node.type}`)
      return renderProseChildren(node, warn, pages, field)
    }
  }
}

/**
 * A table in a region that scrolls sideways on narrow screens. A first row of header cells becomes
 * the head, its cells headers of their columns; a header cell further down heads its row. A cell
 * holding one paragraph renders its text without the paragraph.
 */
function renderTable(
  node: PmNode,
  warn: OnWarn,
  pages?: Document['pages'],
  field?: FieldText,
): string {
  const [first, ...rest] = node.content ?? []
  const head = first?.content?.every((cell) => cell.type === 'tableHeader')
  const row = (row: PmNode, scope: string) =>
    `<tr>${(row.content ?? [])
      .map((cell) => {
        const tag = cell.type === 'tableHeader' ? 'th' : 'td'
        let attrs = tag === 'th' ? ` scope="${scope}"` : ''
        for (const span of ['colspan', 'rowspan']) {
          const value = Number(cell.attrs?.[span])
          if (value > 1) attrs += ` ${span}="${value}"`
        }
        const align = cell.attrs?.align
        if (align === 'center' || align === 'right') attrs += ` style="text-align:${align}"`
        return `<${tag}${attrs}>${richTextInlineHtml(cell as RichText, warn, pages, field)}</${tag}>`
      })
      .join('')}</tr>`
  const body = (head ? rest : (node.content ?? [])).map((r) => row(r, 'row')).join('')
  return `<div class="lc-table" role="region" aria-label="Table" tabindex="0"><table>${head ? `<thead>${row(first!, 'col')}</thead>` : ''}<tbody>${body}</tbody></table></div>`
}

/** Tiptap JSON to HTML. Unknown nodes render their children and warn. */
export function richTextToHtml(
  rt: RichText,
  warn: OnWarn,
  pages?: Document['pages'],
  field?: FieldText,
): string {
  return (rt.content ?? []).map((c) => renderProseNode(c as PmNode, warn, pages, field)).join('')
}

/** A document that is exactly one paragraph renders without the wrapper, for headings and links. */
export function richTextInlineHtml(
  rt: RichText,
  warn: OnWarn,
  pages?: Document['pages'],
  field?: FieldText,
): string {
  const content = rt.content ?? []
  const only = content[0] as PmNode | undefined
  if (content.length === 1 && only?.type === 'paragraph')
    return renderProseChildren(only, warn, pages, field)
  return richTextToHtml(rt, warn, pages, field)
}
