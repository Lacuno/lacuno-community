import type { RichText } from '@freeflow/schema'
import { escapeAttr, escapeHtml, type Warn } from './html.js'

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

function renderMarks(text: string, marks: PmNode['marks'], warn: Warn): string {
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
        const href = String(mark.attrs?.href ?? '#')
        const target = mark.attrs?.target
          ? ` target="${escapeAttr(String(mark.attrs.target))}"`
          : ''
        const rel = target ? ' rel="noopener"' : ''
        out = `<a href="${escapeAttr(href)}"${target}${rel}>${out}</a>`
        break
      }
      default:
        warn(`unknown rich text mark ${mark.type}`)
    }
  }
  return out
}

function renderChildren(node: PmNode, warn: Warn): string {
  return (node.content ?? []).map((c) => renderNode(c, warn)).join('')
}

function renderNode(node: PmNode, warn: Warn): string {
  switch (node.type) {
    case 'text':
      return renderMarks(escapeHtml(node.text ?? ''), node.marks, warn)
    case 'hardBreak':
      return '<br>'
    case 'horizontalRule':
      return '<hr>'
    case 'heading': {
      const raw = Number(node.attrs?.level)
      const level = Number.isFinite(raw) ? Math.min(6, Math.max(1, raw)) : 2
      return `<h${level}>${renderChildren(node, warn)}</h${level}>`
    }
    case 'codeBlock':
      return `<pre><code>${renderChildren(node, warn)}</code></pre>`
    default: {
      const tag = node.type ? BLOCK_TAGS[node.type] : undefined
      if (tag) return `<${tag}>${renderChildren(node, warn)}</${tag}>`
      warn(`unknown rich text node ${node.type}`)
      return renderChildren(node, warn)
    }
  }
}

/** Tiptap JSON to HTML. Unknown nodes render their children and warn. */
export function richTextToHtml(rt: RichText, warn: Warn): string {
  return (rt.content ?? []).map((c) => renderNode(c as PmNode, warn)).join('')
}

/** A document that is exactly one paragraph renders without the wrapper, for headings and links. */
export function richTextInlineHtml(rt: RichText, warn: Warn): string {
  const content = rt.content ?? []
  const only = content[0] as PmNode | undefined
  if (content.length === 1 && only?.type === 'paragraph') return renderChildren(only, warn)
  return richTextToHtml(rt, warn)
}
