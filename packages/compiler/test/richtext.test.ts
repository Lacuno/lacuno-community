import { fixtureDocument, type RichText } from '@miralo/schema'
import { describe, expect, it } from 'vitest'
import { richTextInlineHtml, richTextToHtml } from '../src/richtext.js'

const noWarn = () => {}

describe('richTextToHtml', () => {
  it('renders fractional em sizes and clamps heading levels to integer HTML tags', () => {
    expect(
      richTextToHtml(
        {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 2.7 },
              content: [
                {
                  type: 'text',
                  text: 'Small',
                  marks: [{ type: 'textStyle', attrs: { fontSize: '.5rem' } }],
                },
              ],
            },
          ],
        },
        noWarn,
      ),
    ).toBe('<h2><span style="font-size:.5rem">Small</span></h2>')
  })
  it('renders inline font families and explicit normal styles safely', () => {
    const render = (attrs: Record<string, string>) =>
      richTextInlineHtml(
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Words', marks: [{ type: 'textStyle', attrs }] }],
            },
          ],
        },
        noWarn,
      )
    expect(render({ fontFamily: 'Georgia, serif', fontWeight: '400', fontStyle: 'normal' })).toBe(
      '<span style="font-family:Georgia, serif;font-weight:400;font-style:normal">Words</span>',
    )
    expect(
      render({
        fontFamily: 'Arial;position:fixed',
        fontWeight: '400;color:red',
        fontStyle: 'italic;color:red',
      }),
    ).toBe('Words')
  })
  it('resolves page references against current paths and does not render deleted destinations', () => {
    const doc = fixtureDocument()
    const rt: RichText = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Home',
              marks: [{ type: 'link', attrs: { pageId: 'p-home', href: '/stale' } }],
            },
          ],
        },
      ],
    }
    expect(richTextInlineHtml(rt, noWarn, doc.pages)).toBe('<a href="/">Home</a>')
    doc.pages['p-home']!.path = '/new-home'
    expect(richTextInlineHtml(rt, noWarn, doc.pages)).toBe('<a href="/new-home">Home</a>')
    delete doc.pages['p-home']
    expect(richTextInlineHtml(rt, noWarn, doc.pages)).toBe('Home')
  })
  it('renders safe inline colors and sizes, rejecting executable links and CSS injection', () => {
    const render = (href: string, color: string, fontSize: string) =>
      richTextInlineHtml(
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'Words',
                  marks: [
                    { type: 'link', attrs: { href } },
                    { type: 'textStyle', attrs: { color, fontSize } },
                  ],
                },
              ],
            },
          ],
        },
        noWarn,
      )
    expect(render('https://example.com', '#7047eb', '24px')).toBe(
      '<a href="https://example.com"><span style="color:#7047eb;font-size:24px">Words</span></a>',
    )
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,evil',
      'java\nscript:alert(1)',
      '//evil.test',
      '/\\evil.test',
    ]) {
      expect(render(href, 'red;background:url(evil)', '20px;position:fixed')).toBe('Words')
    }
  })
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

  it('falls back to h2 for a non-numeric heading level instead of hNaN', () => {
    const rt: RichText = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 'big' }, content: [{ type: 'text', text: 'Title' }] },
      ],
    }
    expect(richTextToHtml(rt, noWarn)).toBe('<h2>Title</h2>')
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
