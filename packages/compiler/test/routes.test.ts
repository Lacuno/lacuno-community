import { fixtureDocument } from '@lacuno/schema'
import { describe, expect, it } from 'vitest'
import { RenderError } from '../src/errors.js'
import { enumerateRoutes, routePath } from '../src/routes.js'

describe('routes', () => {
  it('substitutes params', () => {
    expect(routePath('/', undefined)).toBe('/')
    expect(routePath('/blog/[slug]', 'a-b')).toBe('/blog/a-b')
    expect(routePath('/docs/[section]/[page]', 'x')).toBe('/docs/x/x')
  })

  it('enumerates static pages and one route per entry', () => {
    expect(enumerateRoutes(fixtureDocument())).toEqual([
      { path: '/', page: 'p-home' },
      { path: '/404', page: 'p-not-found' },
      { path: '/blog/hello-world', page: 'p-post', entry: 'e-1' },
      { path: '/blog/second-post', page: 'p-post', entry: 'e-2' },
      { path: '/blog/third-post', page: 'p-post', entry: 'e-3' },
    ])
  })

  it('rejects duplicate output paths', () => {
    const doc = fixtureDocument()
    doc.pages['p-dup'] = { id: 'p-dup', name: 'Dup', path: '/blog/hello-world', root: 'n-home' }
    expect(() => enumerateRoutes(doc)).toThrow(RenderError)
    expect(() => enumerateRoutes(doc)).toThrow('duplicate route /blog/hello-world')
  })

  it('yields no routes for a collection page without entries', () => {
    const doc = fixtureDocument()
    doc.entries = {}
    expect(enumerateRoutes(doc)).toEqual([
      { path: '/', page: 'p-home' },
      { path: '/404', page: 'p-not-found' },
    ])
  })
})
