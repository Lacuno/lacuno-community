import type { Browser } from 'playwright'
import { InputError } from './errors.js'

export type ScreenshotOptions = {
  width: number
  height?: number | undefined
  node?: string | undefined
}
/** The bytes of the asset stored under `hash`, or nothing when it is missing. */
export type ReadAsset = (hash: string) => Promise<Buffer | undefined>
/** A site asset's type and bytes by its public path, or nothing when there is none. */
export type AssetAt = (path: string) => Promise<{ mime: string; body: Buffer } | undefined>
/** A PNG of `html`; `page.screenshot` is offered only with one. */
export type Screenshot = (
  html: string,
  assetAt: AssetAt,
  options: ScreenshotOptions,
) => Promise<Buffer>

const ORIGIN = 'http://preview.lacuno'

/**
 * A PNG of `html` in a fresh context of `browser`. The page and its `/assets/*` requests are
 * served from memory and `assetAt` by request interception, so nothing is written to disk; every
 * other request is aborted, so embeds and custom code reach no third party. Without a height the
 * whole page is captured; with `node`, only that element, which needs annotated HTML.
 */
export async function render(
  browser: Browser,
  html: string,
  assetAt: AssetAt,
  { width, height, node }: ScreenshotOptions,
): Promise<Buffer> {
  const context = await browser.newContext({
    viewport: { width, height: height ?? 800 },
    reducedMotion: 'reduce',
  })
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    // The later route wins, so only the preview origin is served.
    await page.route('**', (route) => route.abort())
    await page.route(`${ORIGIN}/**`, async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
      const asset = await assetAt(pathname)
      return asset
        ? route.fulfill({ contentType: asset.mime, body: asset.body })
        : route.fulfill({ status: 404 })
    })
    await page.goto(`${ORIGIN}/`, { waitUntil: 'load' })
    // Fonts, then lazy images below the fold, which would otherwise be captured blank; at most 5s.
    // decode() also waits for the load; after only `load`, an async-decoded image can paint blank.
    await page.evaluate(`Promise.race([
      new Promise((r) => setTimeout(r, 5000)),
      document.fonts.ready.then(() => Promise.all([...document.images].map((img) => {
        img.loading = 'eager'
        return img.decode().catch(() => {})
      }))),
    ]).then(() => {})`)
    if (node === undefined) return await page.screenshot({ fullPage: height === undefined })
    const element = page.locator(`[data-lacuno-node="${node}"]`).first()
    if (!(await element.count())) throw new InputError(`node ${node} is not rendered on this page`)
    return await element.screenshot()
  } finally {
    await context.close()
  }
}

/** Screenshots in a Chromium of their own through this machine's Playwright, if it is installed. */
export function localScreenshot(): Screenshot | undefined {
  try {
    import.meta.resolve('playwright')
  } catch {
    return
  }
  return async (html, assetAt, options) => {
    const { chromium } = await import('playwright')
    const browser = await chromium.launch().catch((e: Error) => {
      throw new InputError(
        `Chromium did not start: run \`npx playwright install chromium\`. ${e.message.split('\n')[0]}`,
      )
    })
    try {
      return await render(browser, html, assetAt, options)
    } finally {
      await browser.close()
    }
  }
}

/**
 * Screenshots through a screenshot service at `url` (`apps/server`'s screenshot-main), sending the
 * page with only the assets it references.
 */
export function serviceScreenshot(url: string, secret: string | undefined): Screenshot {
  return async (html, assetAt, options) => {
    const form = new FormData()
    form.set('request', JSON.stringify(options))
    form.set('html', html)
    for (const path of new Set(html.match(/\/assets\/[\w.-]+/g))) {
      const asset = await assetAt(path)
      if (asset)
        form.set(`asset:${path}`, new Blob([new Uint8Array(asset.body)], { type: asset.mime }))
    }
    const response = await fetch(`${url}/screenshot`, {
      method: 'POST',
      body: form,
      ...(secret && { headers: { authorization: `Bearer ${secret}` } }),
    })
    if (response.status === 503)
      throw new InputError('Screenshots are busy. Try again in a few seconds.')
    if (response.status === 400)
      throw new InputError(((await response.json()) as { error: string }).error)
    if (!response.ok) throw new Error(`The screenshot service answered ${response.status}.`)
    return Buffer.from(await response.arrayBuffer())
  }
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}
