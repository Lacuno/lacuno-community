import { fixtureDocument } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { renderPreview } from '../src/index.js'

it('previews a page, an entry and a component, and names what is missing', () => {
  const doc = fixtureDocument()
  const home = renderPreview(doc, 's', { page: 'p-home' })
  expect(home).toMatchObject({ status: 200, body: { revision: doc.revision } })
  expect(renderPreview(doc, 's', { page: 'p-post', entry: 'e-1' }).status).toBe(200)
  const component = Object.keys(doc.components)[0]!
  expect(renderPreview(doc, 's', { page: 'p-home', component }).status).toBe(200)
  expect(renderPreview(doc, 's', {})).toEqual({ status: 404, body: { error: 'Page not found' } })
  expect(renderPreview(doc, 's', { page: 'p-post' })).toEqual({
    status: 400,
    body: { error: 'Choose a collection entry to preview' },
  })
  expect(renderPreview(doc, 's', { page: 'p-home', component: 'missing' })).toEqual({
    status: 404,
    body: { error: 'Component not found' },
  })
})
