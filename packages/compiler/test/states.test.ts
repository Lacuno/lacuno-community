/// <reference lib="dom" />
import { generateStylesheet } from '@lacuno/css'
import { createEmptyDocument, type Document, type State, styleKey } from '@lacuno/schema'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { plainImageResolver } from '../src/images.js'
import { assembleDocument, render } from '../src/render.js'

/**
 * A page with an accordion item whose icon turns while it is open, a section a link jumps to, and
 * a menu whose button's bar fades while its panel is open.
 */
function page() {
  const doc: Document = createEmptyDocument()
  const home = Object.values(doc.pages)[0]!
  const add = (
    id: string,
    tag: string,
    parent: string,
    attrs: Record<string, string> = {},
    cls?: string,
  ) => {
    doc.nodes[id] = {
      id,
      type: 'element',
      tag,
      parent,
      children: [],
      classes: cls ? [cls] : [],
      attrs: Object.fromEntries(
        Object.entries(attrs).map(([name, value]) => [name, { type: 'static', value }]),
      ),
    }
    doc.nodes[parent]!.children.push(id)
    if (cls) doc.classes[cls] = { id: cls, kind: 'class', name: cls }
  }
  const label = (id: string, parent: string, value: string) => {
    doc.nodes[id] = {
      id,
      type: 'text',
      tag: 'span',
      parent,
      children: [],
      classes: [],
      text: { type: 'static', value },
    }
    doc.nodes[parent]!.children.push(id)
  }
  add('item', 'details', home.root, {}, 'item')
  add('question', 'summary', 'item')
  label('question-text', 'question', 'Question')
  add('icon', 'span', 'question', {}, 'icon')
  add('answer', 'p', 'item')
  add('link', 'a', home.root, { href: '#services' })
  label('link-text', 'link', 'Services')
  add('spacer', 'div', home.root, { style: 'height:2000px' })
  add('services', 'section', home.root, { id: 'services' }, 'section')
  add('menu', 'div', home.root, {}, 'menu')
  add('button', 'button', 'menu', { popovertarget: 'panel' })
  add('bar', 'span', 'button', {}, 'bar')
  label('button-text', 'button', 'Menu')
  add('panel', 'nav', 'menu', { id: 'panel', popover: 'auto' })
  const style = (cls: string, state: State, property: string, value: string, of?: string) => {
    const d = {
      class: cls,
      breakpoint: 'base',
      state,
      ...(of ? { of } : {}),
      property,
      value: { type: 'raw' as const, value },
    }
    doc.styles[styleKey(d)] = d
  }
  style('icon', 'open', 'rotate', '45deg', 'item')
  style('section', 'target', 'background-color', 'rgb(255, 0, 0)')
  style('bar', 'open', 'opacity', '0', 'menu')
  const result = render(doc, home, undefined, { resolveImage: plainImageResolver })
  result.head += `<style>${generateStylesheet(doc).css}</style>`
  return assembleDocument(result)
}

it('turns an open item, marks the section a link jumped to and follows an open menu', async () => {
  const html = page()
  const browser = await chromium.launch({ headless: true })
  try {
    // Without motion, so each style is read at its end and not on its way.
    const tab = await browser.newPage({ reducedMotion: 'reduce' })
    await tab.route('http://site.test/', (route) =>
      route.fulfill({ contentType: 'text/html', body: html }),
    )
    await tab.goto('http://site.test/')
    const read = (selector: string, property: string) =>
      tab.$eval(
        selector,
        (element, name) => getComputedStyle(element).getPropertyValue(name),
        property,
      )
    expect(await read('.icon', 'rotate')).toBe('none')
    await tab.click('summary')
    expect(await read('.icon', 'rotate')).toBe('45deg')
    expect(await read('.section', 'background-color')).toBe('rgba(0, 0, 0, 0)')
    await tab.click('a[href="#services"]')
    expect(await read('.section', 'background-color')).toBe('rgb(255, 0, 0)')
    expect(await read('.bar', 'opacity')).toBe('1')
    await tab.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await tab.click('button')
    expect(await read('.bar', 'opacity')).toBe('0')
  } finally {
    await browser.close()
  }
}, 20000)
