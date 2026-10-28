import { fixtureDocument, fixtureTwoLanguageDocument } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { renderPreview, renderSitePreview } from '../src/index.js'

it('previews a page, an entry and a component, and names what is missing', () => {
  const doc = fixtureDocument()
  const home = renderPreview(doc, 's', { page: 'p-home' })
  expect(home).toMatchObject({ status: 200, body: { revision: doc.revision } })
  // The canvas holds scroll motion still; published pages never carry the attribute.
  expect(home.body).toMatchObject({
    html: expect.stringContaining('<html data-lacuno-still="" lang="en">'),
  })
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

it('previews the site by route, as it publishes, with links handed to the editor', () => {
  const doc = fixtureTwoLanguageDocument()
  const post = renderSitePreview(doc, 's', { page: 'p-post', entry: 'e-1', locale: '' })
  expect(post).toMatchObject({ status: 200, body: { path: '/blog/hello-world' } })
  const about = renderSitePreview(doc, 's', { path: '/de/ueber-uns/' })
  if (about.status !== 200) throw new Error('About not rendered')
  expect(about.body).toMatchObject({ path: '/de/ueber-uns', revision: doc.revision })
  expect(about.body.html).toContain('<html lang="de">')
  expect(about.body.html).toContain('Zur Startseite')
  expect(about.body.html).not.toContain('data-lacuno-node=')
  expect(about.body.html).toContain('lacunoPreview')
  // A draft language previews, and a path the site lacks shows its 404 page.
  expect(renderSitePreview(doc, 's', { page: 'p-about', locale: 'fr' }).status).toBe(200)
  const notFound = renderSitePreview(doc, 's', { path: '/404' })
  expect(renderSitePreview(doc, 's', { path: '/missing' })).toEqual({
    ...notFound,
    body: { ...notFound.body, path: '/missing' },
  })
  delete doc.pages['p-not-found']
  expect(renderSitePreview(doc, 's', { path: '/missing' })).toEqual({
    status: 404,
    body: { error: 'Page not found' },
  })
})
