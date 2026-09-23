import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { publicAssetPath } from '@freeflow/compiler'
import type { Document } from '@freeflow/schema'
import { InputError } from './errors.js'

export type ScreenshotOptions = { width: number; height?: number; node?: string }

const ORIGIN = 'http://preview.freeflow'

/**
 * A PNG of `html` in headless Chromium. The page and its `/assets/*` requests are served from
 * memory and the site folder by request interception, so nothing is written to disk. Without a
 * height the whole page is captured; with `node`, only that element, which needs annotated HTML.
 */
export async function screenshot(
  doc: Document,
  siteDir: string,
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
    await page.route(`${ORIGIN}/**`, async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: html })
      const asset = Object.values(doc.assets).find((a) => publicAssetPath(a) === pathname)
      const body =
        asset && (await readFile(path.join(siteDir, 'assets', asset.hash)).catch(() => undefined))
      return body
        ? route.fulfill({ contentType: asset.mime, body })
        : route.fulfill({ status: 404 })
    })
    await page.goto(`${ORIGIN}/`, { waitUntil: 'load' })
    await page.evaluate('document.fonts.ready.then(() => {})')
    // Lazy images below the fold would otherwise be captured blank.
    await page.evaluate(`Promise.all([...document.images].map((img) => {
      img.loading = 'eager'
      return img.complete
        ? img.decode().catch(() => {})
        : new Promise((r) => { img.onload = img.onerror = r })
    }))`)
    if (node === undefined) return await page.screenshot({ fullPage: height === undefined })
    const element = page.locator(`[data-freeflow-node="${node}"]`).first()
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
