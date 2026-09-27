import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('draws the home page as the site’s thumbnail when the editor closes and shows it in the site list', async () => {
  const { page, api, siteId } = await editor()
  await page.getByRole('button', { name: 'Back to sites' }).click()
  const thumbnail = page.locator('img.site-thumbnail')
  await expect
    .poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(640)
  const { sites } = (await (await api('/api/sites')).json()) as {
    sites: { id: string; revision: number; thumbnail: number | null }[]
  }
  expect(sites[0]).toMatchObject({ id: siteId, thumbnail: sites[0]!.revision })
  const response = await api(`/api/sites/${siteId}/thumbnail`)
  expect(response.headers.get('content-type')).toBe('image/webp')
  expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
  const bytes = (await response.arrayBuffer()).byteLength
  expect(bytes).toBeGreaterThan(5_000)
  expect(bytes).toBeLessThan(60_000)
  // The page itself, with its logo and fonts, not a blank or broken image.
  const colours = await thumbnail.evaluate((image: HTMLImageElement) => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 40
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0, 64, 40)
    const data = context.getImageData(0, 0, 64, 40).data
    const seen = new Set<number>()
    for (let i = 0; i < data.length; i += 4)
      seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!)
    return seen.size
  })
  expect(colours).toBeGreaterThan(20)
}, 60_000)
