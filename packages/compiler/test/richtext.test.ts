import type { RichText } from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import { richTextInlineHtml, richTextToHtml } from '../src/richtext.js'

const noWarn = () => {}

describe('richTextToHtml', () => {
  it('renders paragraphs, headings, marks and breaks', () => {
    const rt: RichText = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'x < y', marks: [{ type: 'italic' }, { type: 'code' }] },
            {
              type: 'text',
              text: 'link',
              marks: [{ type: 'link', attrs: { href: 'https://a.b/?q=1&r=2' } }],
            },
          ],
        },
      ],
    }
    expect(richTextToHtml(rt, noWarn)).toBe(
      '<h2>Title</h2><p>Hello <strong>bold</strong><br><em><code>x &lt; y</code></em><a href="https://a.b/?q=1&amp;r=2">link</a></p>',
    )
  })

  it('renders lists, quotes, code blocks and rules', () => {
    const rt: RichText = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
            },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }],
            },
          ],
        },
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'let x = 1' }] },
        { type: 'horizontalRule' },
      ],
    }
    expect(richTextToHtml(rt, noWarn)).toBe(
      '<ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol><blockquote><p>q</p></blockquote><pre><code>let x = 1</code></pre><hr>',
    )
  })

  it('warns on unknown nodes and marks but keeps the text', () => {
    const warnings: string[] = []
    const rt: RichText = {
      type: 'doc',
      content: [
        {
          type: 'callout',
          content: [{ type: 'text', text: 'kept', marks: [{ type: 'sparkle' }] }],
        },
      ],
    }
    expect(richTextToHtml(rt, (m) => warnings.push(m))).toBe('kept')
    expect(warnings).toEqual(['unknown rich text node callout', 'unknown rich text mark sparkle'])
  })

  it('unwraps a single paragraph for inline use', () => {
    const one: RichText = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'only' }] }],
    }
    const two: RichText = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ],
    }
    expect(richTextInlineHtml(one, noWarn)).toBe('only')
    expect(richTextInlineHtml(two, noWarn)).toBe('<p>a</p><p>b</p>')
    expect(richTextInlineHtml({ type: 'doc' }, noWarn)).toBe('')
  })
})
