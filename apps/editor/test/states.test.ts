import { fixtureDocument } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { applicableStates } from '../src/states.js'

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
