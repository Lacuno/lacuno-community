import {
  type Document,
  type RichText,
  safeLinkHref,
  safeTextStyleValue,
  textStyleProperties,
} from '@freeflow/schema'
import { escapeAttr, escapeHtml, type OnWarn } from './html.js'

type PmNode = {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type?: string; attrs?: Record<string, unknown> }[]
  content?: PmNode[]
}

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

function renderProseChildren(node: PmNode, warn: OnWarn, pages?: Document['pages']): string {
  return (node.content ?? []).map((c) => renderProseNode(c, warn, pages)).join('')
}

function renderProseNode(node: PmNode, warn: OnWarn, pages?: Document['pages']): string {
  switch (node.type) {
    case 'text':
      return renderMarks(escapeHtml(node.text ?? ''), node.marks, warn, pages)
    case 'hardBreak':
      return '<br>'
    case 'horizontalRule':
      return '<hr>'
    case 'heading': {
      const raw = Number(node.attrs?.level)
      const level = Number.isFinite(raw) ? Math.min(6, Math.max(1, Math.trunc(raw))) : 2
      return `<h${level}>${renderProseChildren(node, warn, pages)}</h${level}>`
    }
    case 'codeBlock':
      return `<pre><code>${renderProseChildren(node, warn, pages)}</code></pre>`
    default: {
      const tag = node.type ? BLOCK_TAGS[node.type] : undefined
      if (tag) return `<${tag}>${renderProseChildren(node, warn, pages)}</${tag}>`
      warn(`unknown rich text node ${node.type}`)
      return renderProseChildren(node, warn, pages)
    }
  }
}

/** Tiptap JSON to HTML. Unknown nodes render their children and warn. */
export function richTextToHtml(rt: RichText, warn: OnWarn, pages?: Document['pages']): string {
  return (rt.content ?? []).map((c) => renderProseNode(c as PmNode, warn, pages)).join('')
}

/** A document that is exactly one paragraph renders without the wrapper, for headings and links. */
export function richTextInlineHtml(rt: RichText, warn: OnWarn, pages?: Document['pages']): string {
  const content = rt.content ?? []
  const only = content[0] as PmNode | undefined
  if (content.length === 1 && only?.type === 'paragraph')
    return renderProseChildren(only, warn, pages)
  return richTextToHtml(rt, warn, pages)
}
