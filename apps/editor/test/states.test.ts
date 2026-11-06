import { fixtureDocument, type Node } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { applicableStates, pickedOption, stateOptions } from '../src/states.js'

it('offers only the states an element can be in', () => {
  const doc = fixtureDocument()
  const link = Object.values(doc.nodes).find(
    (node) => 'tag' in node && node.tag === 'a' && 'href' in (node.attrs ?? {}),
  )!
  const container = Object.values(doc.nodes).find(
    (node) => 'tag' in node && node.tag === 'div' && node.children.length > 1,
  )!
  const only = doc.nodes[container.children[0]!]!
  const lonely = { ...only, id: 'n-lonely', parent: 'n-solo' }
  doc.nodes['n-solo'] = { ...container, id: 'n-solo', children: ['n-lonely'] }
  doc.nodes['n-lonely'] = lonely
  const linkStates = applicableStates(doc, link)
  expect(linkStates).toEqual(
    expect.arrayContaining(['hover', 'focus', 'focus-visible', 'visited', 'active']),
  )
  const divStates = applicableStates(doc, container)
  expect(divStates).toContain('hover')
  expect(divStates).not.toContain('focus')
  expect(divStates).not.toContain('visited')
  expect(applicableStates(doc, lonely)).not.toContain('first-child')
  expect(applicableStates(doc, only)).toContain('first-child')
})

/** A link card holding an image, and an accordion item holding an icon, inside the hero. */
function parents() {
  const doc = fixtureDocument()
  const add = (id: string, tag: string, parent: string, extra: Partial<Node> = {}) => {
    doc.nodes[id] = {
      id,
      type: 'element',
      tag,
      parent,
      children: [],
      classes: [],
      ...extra,
    } as Node
    doc.nodes[parent]!.children.push(id)
    for (const cls of doc.nodes[id]!.classes) doc.classes[cls] = { id: cls, kind: 'local' }
  }
  add('card', 'a', 'n-hero-inner', {
    classes: ['c-card'],
    attrs: { href: { type: 'static', value: '/' } },
    meta: { label: 'Card' },
  })
  add('photo', 'img', 'card', { classes: ['c-photo'] })
  add('title', 'span', 'card', { classes: ['c-title'] })
  add('item', 'details', 'n-hero-inner', { classes: ['c-item'], meta: { label: 'Accordion item' } })
  add('question', 'summary', 'item')
  add('icon', 'span', 'question', { classes: ['c-icon'] })
  add('anchor', 'section', 'n-hero-inner', { attrs: { id: { type: 'static', value: 'faq' } } })
  return doc
}

it('offers open and jumped to where they can happen, and the state of a parent', () => {
  const doc = parents()
  const keys = (id: string) => stateOptions(doc, doc.nodes[id]!).map((option) => option.key)
  expect(keys('item')).toContain('open')
  expect(keys('anchor')).toContain('target')
  expect(keys('card')).not.toContain('open')
  expect(keys('icon')).toContain('open@c-item')
  expect(keys('photo')).toContain('hover@c-card')
  expect(keys('photo')).not.toContain('open@c-item')
  const parent = stateOptions(doc, doc.nodes.icon!).find((option) => option.trigger)
  expect(parent).toMatchObject({ label: 'Accordion item · Open', trigger: 'item' })
})

it('keeps a state with the element it was picked on, for what is selected inside it', () => {
  const doc = parents()
  const pick = (
    id: string,
    picked: { key: Parameters<typeof pickedOption>[2]['key']; on: string },
  ) => pickedOption(doc.nodes[id]!, stateOptions(doc, doc.nodes[id]!, picked), picked).key
  // Hover picked on the card: the image inside it edits while the card is hovered.
  expect(pick('photo', { key: 'hover', on: 'card' })).toBe('hover@c-card')
  // Picked inside: the title follows the same parent; the card itself takes its own hover.
  expect(pick('title', { key: 'hover@c-card', on: 'photo' })).toBe('hover@c-card')
  expect(pick('card', { key: 'hover@c-card', on: 'photo' })).toBe('hover')
  // Anywhere else a state stays while the element can be in it, as before.
  expect(pick('item', { key: 'hover', on: 'card' })).toBe('hover')
  expect(pick('anchor', { key: 'open', on: 'item' })).toBe('none')
})
