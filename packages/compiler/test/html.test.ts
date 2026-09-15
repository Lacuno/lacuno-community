import { describe, expect, it } from 'vitest'
import { escapeAttr, escapeHtml, renderAttrs, VOID_TAGS } from '../src/html.js'

describe('html utilities', () => {
  it('escapes text and attributes', () => {
    expect(escapeHtml('<a href="x">Tom & Jerry</a>')).toBe(
      '&lt;a href="x"&gt;Tom &amp; Jerry&lt;/a&gt;',
    )
    expect(escapeAttr('say "hi" & <bye>')).toBe('say &quot;hi&quot; &amp; &lt;bye&gt;')
  })

  it('renders attributes sorted with boolean support', () => {
    expect(renderAttrs({ href: '/x', class: 'a b', hidden: true })).toBe(
      ' class="a b" hidden href="/x"',
    )
    expect(renderAttrs({})).toBe('')
  })

  it('knows void tags', () => {
    expect(VOID_TAGS.has('img')).toBe(true)
    expect(VOID_TAGS.has('div')).toBe(false)
  })
})
