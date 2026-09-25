import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { PublicationReader } from '../src/publication-reader.js'

const site = '0b6f3c1e-2a4d-4f8b-9c7e-1d2e3f4a5b6c'
const reader = (base: string) => new PublicationReader(new Database(':memory:'), '.', base)

describe('publication hosts', () => {
  it('puts the site label in front of a plain base', () => {
    const plain = reader('https://sites.example.net')
    expect(plain.url(site)).toBe(`https://${site}.sites.example.net`)
    expect(plain.url(site, 'testing')).toBe(`https://${site}-testing.sites.example.net`)
    expect(plain.siteForHost(`${site}.sites.example.net`)).toEqual({
      siteId: site,
      target: 'production',
    })
    expect(plain.siteForHost(`${site}-testing.sites.example.net`)).toEqual({
      siteId: site,
      target: 'testing',
    })
    expect(plain.siteForHost(`x.${site}.sites.example.net`)).toBeUndefined()
    expect(plain.siteForHost(`${site}.sites.example.com`)).toBeUndefined()
    expect(plain.siteForHost('sites.example.net')).toBeUndefined()
  })

  it('fills in a {site} template', () => {
    const template = reader('https://{site}--k3j9x2a1bc.sites.miralo.io:4000')
    expect(template.url(site)).toBe(`https://${site}--k3j9x2a1bc.sites.miralo.io:4000`)
    expect(template.url(site, 'testing')).toBe(
      `https://${site}-testing--k3j9x2a1bc.sites.miralo.io:4000`,
    )
    expect(template.siteForHost(`${site}--k3j9x2a1bc.sites.miralo.io`)).toEqual({
      siteId: site,
      target: 'production',
    })
    expect(template.siteForHost(`${site}-testing--k3j9x2a1bc.sites.miralo.io`)).toEqual({
      siteId: site,
      target: 'testing',
    })
    expect(template.siteForHost(`x.${site}--k3j9x2a1bc.sites.miralo.io`)).toBeUndefined()
    expect(template.siteForHost(`${site}--k3j9x2a1bc.x.sites.miralo.io`)).toBeUndefined()
    expect(template.siteForHost(`${site}--other00000.sites.miralo.io`)).toBeUndefined()
    expect(template.siteForHost(`${site}.sites.miralo.io`)).toBeUndefined()
    expect(() => reader('https://{site}.{site}.example.net')).toThrow('{site} once')
  })
})
