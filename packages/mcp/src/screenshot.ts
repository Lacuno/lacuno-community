import { setTimeout as sleep } from 'node:timers/promises'
import type { Browser, BrowserContext } from 'playwright'
import { InputError } from './errors.js'

export type ScreenshotOptions = {
  width: number
  height?: number | undefined
  node?: string | undefined
  /** The most of a full page that is captured, 4000 px unless asked for more. */
  maxHeight?: number | undefined
  /** Also measure every annotated node; the answer is then `{ image, boxes }`. */
  boxes?: true | undefined
}
/** Where an annotated node is on the page, in CSS px at the viewport width, with `depth` annotated ancestors. */
export type Box = {
  id: string
  tag: string
  depth: number
  x: number
  y: number
  w: number
  h: number
}
/**
 * How many px the page is wider than the screen, and the deepest elements that reach past it with
 * nothing around them clipping, the ones to fix, at most five: tag, classes, node id where the
 * markup is annotated, and the start of their text, as `h2.card-title "Vorsorgeuntersuchung"`.
 */
export type Overflow = { by: number; elements: string[] }
/** A picture, the boxes when they were asked for, and the overflow when the page has any. */
export type Shot = { image: Buffer; boxes?: Box[] | undefined; overflow?: Overflow | undefined }
/** The bytes of the asset stored under `hash`, or nothing when it is missing. */
export type ReadAsset = (hash: string) => Promise<Buffer | undefined>
/** A site asset's type and bytes by its public path, or nothing when there is none. */
export type AssetAt = (path: string) => Promise<{ mime: string; body: Buffer } | undefined>
/**
 * A JPEG of `html`, a PNG of one node, with the boxes of its nodes when `boxes` is asked for;
 * `page.screenshot` and `page.view` are offered only with one.
 */
export type Screenshot = (
  html: string,
  assetAt: AssetAt,
  options: ScreenshotOptions,
) => Promise<Shot>

const ORIGIN = 'http://preview.lacuno'
/**
 * The screenshot service's answer header with the overflow, next to an image body: its JSON
 * URI-encoded, since a header only carries Latin-1 and the elements' text can be anything.
 */
export const OVERFLOW_HEADER = 'x-lacuno-overflow'

/**
 * A screenshot of `html` in a fresh context of `browser`. The page and its `/assets/*` requests
 * are served from memory and `assetAt` by request interception, so nothing is written to disk;
 * every other request is aborted, so embeds and custom code reach no third party. Without a
 * height the whole page is captured, up to `maxHeight`; with `node`, only that element, which
 * needs annotated HTML. A page is a JPEG, a fraction of the PNG's bytes, which an AI reads as
 * well; a node is a PNG, crisp for reading one section's text, without the fixed and sticky
 * elements around it, such as a header that would cover it. With `boxes`, every annotated node
 * with an area is measured too, in document order. A page wider than the screen says so.
 */
export async function render(
  browser: Browser,
  html: string,
  assetAt: AssetAt,
  options: ScreenshotOptions,
  deadline = 30_000,
): Promise<Shot> {
  const context = await browser.newContext({
    viewport: { width: options.width, height: options.height ?? 800 },
    reducedMotion: 'reduce',
  })
  // A page that never finishes, by an endless script or a request that hangs, is cut off at the
  // deadline; a context that will not close then takes its browser along, so the caller goes on.
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      capture(context, html, assetAt, options),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new InputError(`The page did not render within ${deadline / 1000} s.`)),
          deadline,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
    const closed = await Promise.race([
      context.close().then(() => true),
      sleep(5000, false, { ref: false }),
    ])
    if (!closed) await browser.close()
  }
}

async function capture(
  context: BrowserContext,
  html: string,
  assetAt: AssetAt,
  { width, height, node, maxHeight = 4000, boxes }: ScreenshotOptions,
): Promise<Shot> {
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
  // A clipped element widens nothing, and a page whose root or body clips does not scroll sideways.
  const overflow = await page.evaluate<Overflow | undefined>(`(() => {
    const root = document.documentElement
    const by = root.scrollWidth - root.clientWidth
    const clips = (el) => getComputedStyle(el).overflowX !== 'visible'
    if (by < 1 || clips(root) || clips(document.body)) return undefined
    const wide = [...document.body.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect()
      const reach = clips(el) ? r.width : Math.max(r.width, el.scrollWidth)
      if (r.left + scrollX + reach <= root.clientWidth + 1) return false
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
        if (clips(p)) return false
      return true
    })
    const elements = wide
      .filter((el) => !wide.some((other) => other !== el && el.contains(other)))
      .slice(0, 5)
      .map((el) => {
        const id = el.getAttribute('data-lacuno-node')
        const text = el.textContent.replace(/\\s+/g, ' ').trim()
        return [
          el.localName + [...el.classList].map((name) => '.' + name).join(''),
          id,
          text && JSON.stringify(text.length > 40 ? text.slice(0, 40) + '…' : text),
        ].filter(Boolean).join(' ')
      })
    return { by, elements }
  })()`)
  let image: Buffer
  if (node === undefined) {
    const fullPage = height === undefined
    const tall =
      fullPage && (await page.evaluate<number>('document.documentElement.scrollHeight')) > maxHeight
    image = await page.screenshot({
      type: 'jpeg',
      quality: 80,
      fullPage,
      ...(tall && { clip: { x: 0, y: 0, width, height: maxHeight } }),
    })
  } else {
    const element = page.locator(`[data-lacuno-node="${node}"]`).first()
    if (!(await element.count())) throw new InputError(`node ${node} is not rendered on this page`)
    // Hidden, not removed, so the layout stays as it is.
    await page.evaluate(`(() => {
      const target = document.querySelector('[data-lacuno-node=${JSON.stringify(node)}]')
      for (const el of document.body.querySelectorAll('*')) {
        const { position } = getComputedStyle(el)
        if ((position === 'fixed' || position === 'sticky') && !el.contains(target) && !target.contains(el))
          el.style.setProperty('visibility', 'hidden', 'important')
      }
    })()`)
    image = await element.screenshot()
  }
  if (!boxes) return { image, overflow }
  // Measured after the capture, which may have scrolled the page; a node without an area is
  // nothing to point at.
  return {
    image,
    overflow,
    boxes: await page.evaluate<Box[]>(`[...document.querySelectorAll('[data-lacuno-node]')]
      .map((el) => {
        const r = el.getBoundingClientRect()
        let depth = 0
        for (let p = el.parentElement; p; p = p.parentElement)
          if (p.hasAttribute('data-lacuno-node')) depth++
        return {
          id: el.getAttribute('data-lacuno-node'),
          tag: el.tagName.toLowerCase(),
          depth,
          x: Math.round(r.left + scrollX),
          y: Math.round(r.top + scrollY),
          w: Math.round(r.width),
          h: Math.round(r.height),
        }
      })
      .filter((b) => b.w > 0 && b.h > 0)`),
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
 * page with only the assets it references, as `assetAt` gives them.
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
    // A service from before overflow was measured sends none.
    if (!options.boxes) {
      const overflow = response.headers.get(OVERFLOW_HEADER)
      return {
        image: Buffer.from(await response.arrayBuffer()),
        overflow: overflow ? (JSON.parse(decodeURIComponent(overflow)) as Overflow) : undefined,
      }
    }
    const { image, boxes, overflow } = (await response.json()) as Omit<Shot, 'image'> & {
      image: string
    }
    return { image: Buffer.from(image, 'base64'), boxes, overflow }
  }
}

/** A screenshot's type and size: a PNG from its IHDR chunk, a JPEG from its frame header. */
export function imageInfo(image: Buffer): { mime: string; width: number; height: number } {
  if (image[0] === 0x89)
    return { mime: 'image/png', width: image.readUInt32BE(16), height: image.readUInt32BE(20) }
  // Segments of marker and length until a start-of-frame (SOF0 to SOF2), which holds the size.
  let at = 2
  while (!(image[at + 1]! >= 0xc0 && image[at + 1]! <= 0xc2)) at += 2 + image.readUInt16BE(at + 2)
  return {
    mime: 'image/jpeg',
    width: image.readUInt16BE(at + 7),
    height: image.readUInt16BE(at + 5),
  }
}
