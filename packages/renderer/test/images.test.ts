import { fixtureDocument } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { assetUrl, canvasImage, renderPreview } from '../src/index.js'

it('asks for a resized image only where its size is known', () => {
  const doc = fixtureDocument()
  const hero = doc.assets['a-hero']!
  const url = `/api/sites/s/assets/${hero.hash}`
  expect(assetUrl('s', hero)).toBe(url)
  expect(assetUrl('s', hero, 320)).toBe(`${url}?w=320`)
  expect(assetUrl('s', { ...hero, width: undefined }, 320)).toBe(url)
  expect(assetUrl('s', doc.assets['a-clip']!, 320)).toBe(
    `/api/sites/s/assets/${doc.assets['a-clip']!.hash}`,
  )
})

it('renders the canvas image with the variants below its width, then the original', () => {
  const doc = fixtureDocument()
  const hero = doc.assets['a-hero']!
  const url = `/api/sites/s/assets/${hero.hash}`
  const srcset = `${url}?w=320 320w, ${url}?w=640 640w, ${url}?w=960 960w, ${url} 1200w`
  expect(canvasImage('s', hero)).toEqual({ src: url, srcset })
  expect(canvasImage('s', { ...hero, width: undefined })).toEqual({ src: url, srcset: '' })
  expect(canvasImage('s', { ...hero, width: 320 })).toEqual({ src: url, srcset: '' })
  const { body } = renderPreview(doc, 's', { page: 'p-home' })
  expect((body as { html: string }).html).toContain(
    `sizes="100vw" src="${url}" srcset="${srcset}" width="1200"`,
  )
})
