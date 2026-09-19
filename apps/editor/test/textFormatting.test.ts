import { fixtureDocument, type TextNode } from '@freeflow/schema'
import { expect, it } from 'vitest'
import { textDocument, wholeText } from '../src/textFormatting.js'

it('does not silently replace bound text with an empty document', () => {
  expect(() => textDocument({ type: 'field', field: 'f-title' })).toThrow('Bound text')
  expect(textDocument({ type: 'static', value: false })).toMatchObject({
    content: [{ content: [{ text: 'false' }] }],
  })
})

it('whole-text edits remove only the corresponding overrides without mutating the source', () => {
  const node = fixtureDocument().nodes['n-hero-title'] as TextNode
  node.text = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Words',
            marks: [
              { type: 'bold' },
              { type: 'italic' },
              {
                type: 'textStyle',
                attrs: { fontSize: '48px', color: '#cc2244', fontFamily: 'Georgia, serif' },
              },
              { type: 'link', attrs: { pageId: 'p-home' } },
            ],
          },
        ],
      },
    ],
  }
  const before = structuredClone(node.text)
  const updated = wholeText(node, ['font-size', 'font-weight'])
  expect(updated).toMatchObject({
    content: [
      {
        content: [
          {
            marks: [
              { type: 'italic' },
              { type: 'textStyle', attrs: { color: '#cc2244', fontFamily: 'Georgia, serif' } },
              { type: 'link', attrs: { pageId: 'p-home' } },
            ],
          },
        ],
      },
    ],
  })
  expect(JSON.stringify(updated)).not.toContain('fontSize')
  expect(node.text).toEqual(before)
  const linked = wholeText({ ...node, text: updated }, [], { pageId: null, href: '/about' })
  expect(JSON.stringify(linked)).not.toContain('p-home')
  expect(JSON.stringify(linked)).toContain('/about')
  expect(JSON.stringify(wholeText({ ...node, text: linked }, [], null))).not.toContain('link')
})
