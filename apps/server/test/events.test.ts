import type { Operation } from '@lacuno/document'
import { expect, it } from 'vitest'
import { summarize } from '../src/events.js'

const ops = (...types: string[]) => types.map((type) => ({ type }) as Operation)

it('says what a batch did in plain words, largest part first', () => {
  const styles = ops(...Array.from({ length: 12 }, () => 'style.set'))
  const text = { type: 'node.update', id: 'n-1', text: 'Hi' } as unknown as Operation
  expect(
    summarize([...ops('node.create', 'node.create', 'node.create'), ...styles, text], []),
  ).toBe('Changed 12 styles, added 3 elements and edited text')
  expect(summarize(ops('page.create'), [])).toBe('Added a page')
  expect(summarize(ops('asset.create'), [])).toBe('Added a file')
  expect(summarize(ops('node.update'), [])).toBe('Changed an element')
  expect(summarize(ops('designToken.setValue', 'designToken.setValue'), [])).toBe(
    'Changed 2 design tokens',
  )
  expect(summarize(ops('site.update'), [])).toBe('Changed the site settings')
  expect(summarize(ops('redirect.remove', 'field.move'), [])).toBe(
    'Removed a redirect and moved a field',
  )
  expect(
    summarize(ops('style.set', 'style.set', 'page.create', 'class.create', 'asset.delete'), []),
  ).toBe('Changed 2 styles, added a page, added a class and more')
  // An agent's batch reported without its operations.
  expect(summarize(undefined, [{ op: 'set', path: ['x'], value: 1 }] as never)).toBe(
    'Made 1 change',
  )
})
