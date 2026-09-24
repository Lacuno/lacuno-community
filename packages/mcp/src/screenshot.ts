import { publicAssetPath } from '@miralo/compiler'
import type { Document } from '@miralo/schema'
import { InputError } from './errors.js'

export type ScreenshotOptions = { width: number; height?: number; node?: string }
/** The bytes of the asset stored under `hash`, or nothing when it is missing. */
export type ReadAsset = (hash: string) => Promise<Buffer | undefined>

const ORIGIN = 'http://preview.miralo'

/**
 * A PNG of `html` in headless Chromium. The page and its `/assets/*` requests are served from
 * memory and `readAsset` by request interception, so nothing is written to disk; every other
 * request is aborted, so embeds and custom code reach no third party. Without a
 * height the whole page is captured; with `node`, only that element, which needs annotated HTML.
 */
export async function screenshot(
  doc: Document,
  readAsset: ReadAsset,
  html: string,
  { width, height, node }: ScreenshotOptions,
): Promise<Buffer> {
  const { chromium } = await import('playwright').catch(() => {
    throw new InputError(
      'Screenshots need Playwright: run `pnpm add -D playwright && npx playwright install chromium` in this project.',
    )
  })
  const browser = await chromium.launch().catch((e: Error) => {
    throw new InputError(
      `Chromium did not start: run \`npx playwright install chromium\`. ${e.message.split('\n')[0]}`,
    )
  })
  try {
    const page = await browser.newPage({
      viewport: { width, height: height ?? 800 },
      reducedMotion: 'reduce',
    })
    page.setDefaultTimeout(15_000)
    // The later route wins, so only the preview origin is served.
    await page.route('**', (route) => route.abort())
    await page.route(`${ORIGIN}/**`, async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
      const asset = Object.values(doc.assets).find((a) => publicAssetPath(a) === pathname)
      const body = asset && (await readAsset(asset.hash))
      return body
        ? route.fulfill({ contentType: asset.mime, body })
        : route.fulfill({ status: 404 })
    })
    await page.goto(`${ORIGIN}/`, { waitUntil: 'load' })
    // Fonts, then lazy images below the fold, which would otherwise be captured blank; at most 5s.
    await page.evaluate(`Promise.race([
      new Promise((r) => setTimeout(r, 5000)),
      document.fonts.ready.then(() => Promise.all([...document.images].map((img) => {
        img.loading = 'eager'
        return img.complete
          ? img.decode().catch(() => {})
          : new Promise((r) => { img.onload = img.onerror = r })
      }))),
    ]).then(() => {})`)
    if (node === undefined) return await page.screenshot({ fullPage: height === undefined })
    const element = page.locator(`[data-miralo-node="${node}"]`).first()
    if (!(await element.count())) throw new InputError(`node ${node} is not rendered on this page`)
    return await element.screenshot()
  } finally {
    await browser.close()
  }
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}
