import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { writeFixtureSite } from '@lacuno/compiler/build'
import { DocumentStore } from '@lacuno/document'
import { openFolder } from '@lacuno/document/folder'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { imageInfo, localScreenshot } from '../src/screenshot.js'
import { connect } from './helpers.js'

// Chromium already refuses loopback requests from a public page; lifting that lets a local server
// stand in for a third party.
vi.mock('playwright', async (importOriginal) => {
  const pw = await importOriginal<typeof import('playwright')>()
  const args = ['--disable-features=LocalNetworkAccessChecks']
  return { ...pw, chromium: { launch: () => pw.chromium.launch({ args }) } }
})

// The tool launches the headless shell, which can be missing when the full browser is not.
const chromium = await import('playwright')
  .then(({ chromium }) => chromium.launch())
  .then((browser) => browser.close())
  .then(() => true)
  .catch(() => false)

const screenshot = localScreenshot()!
const dirs: string[] = []
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

type Content = { type: string; data?: string; mimeType?: string; text?: string }

/** The screenshot of a result: a JPEG of a page, a PNG of a node. */
function shot(
  result: Record<string, unknown>,
  mime = 'image/jpeg',
): { width: number; height: number; bytes: Buffer } {
  const [image, size] = result.content as Content[]
  expect(image?.mimeType).toBe(mime)
  const bytes = Buffer.from(image?.data ?? '', 'base64')
  const { mime: sniffed, ...out } = imageInfo(bytes)
  expect(sniffed).toBe(mime)
  expect(size?.text).toBe(`${out.width}×${out.height}`)
  return { ...out, bytes }
}

describe('page.screenshot', () => {
  it.skipIf(!chromium)('captures the page at the viewport width and crops to a node', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-mcp-shot-'))
    dirs.push(dir)
    await writeFixtureSite(dir)
    const c = await connect(await openFolder(dir), { siteDir: dir, screenshot })
    close = c.close
    const page = shot(
      await c.client.callTool({ name: 'page.screenshot', arguments: { page: '/', width: 800 } }),
    )
    // The first screen by default, which an AI can read; a long full page it cannot.
    expect([page.width, page.height]).toEqual([800, 800])
    const node = shot(
      await c.client.callTool({
        name: 'page.screenshot',
        arguments: { page: '/', width: 800, node: 'n-hero-title' },
      }),
      'image/png',
    )
    expect(node.width * node.height).toBeLessThan(page.width * page.height)
  })

  it.skipIf(!chromium)(
    'reads assets through the assets option when there is no site folder',
    async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-mcp-shot-'))
      dirs.push(dir)
      const doc = await writeFixtureSite(dir)
      const read: string[] = []
      const c = await connect(DocumentStore.inMemory(doc), {
        screenshot,
        assets: (hash) => {
          read.push(hash)
          return readFile(path.join(dir, 'assets', hash)).catch(() => undefined)
        },
      })
      close = c.close
      const page = shot(
        await c.client.callTool({ name: 'page.screenshot', arguments: { page: '/', width: 800 } }),
      )
      expect(page.width).toBe(800)
      expect(read).toContain(Object.values(doc.assets)[0]?.hash)
    },
  )

  it.skipIf(!chromium)('sends a variant of a raster image in place of its original', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-mcp-shot-'))
    dirs.push(dir)
    const doc = await writeFixtureSite(dir)
    const hero = doc.assets['a-hero']!
    const read: string[] = []
    const widths: number[] = []
    const c = await connect(DocumentStore.inMemory(doc), {
      screenshot,
      assets: (hash) => {
        read.push(hash)
        return readFile(path.join(dir, 'assets', hash)).catch(() => undefined)
      },
      images: async (asset, width) => {
        widths.push(width)
        if (asset.id !== hero.id) return undefined
        return sharp(await readFile(path.join(dir, 'assets', asset.hash)))
          .resize({ width })
          .webp()
          .toBuffer()
      },
    })
    close = c.close
    shot(await c.client.callTool({ name: 'page.screenshot', arguments: { page: '/', width: 640 } }))
    expect(widths).toContain(640)
    expect(read).not.toContain(hero.hash)
  })

  it.skipIf(!chromium)('captures lazy images far below the fold, cut at maxHeight', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-mcp-shot-'))
    dirs.push(dir)
    const doc = await writeFixtureSite(dir)
    const style = (value: string) => ({ style: { type: 'static' as const, value } })
    doc.pages['p-tall'] = { id: 'p-tall', name: 'Tall', path: '/tall', root: 'n-tall' }
    doc.nodes['n-tall'] = {
      id: 'n-tall',
      type: 'element',
      tag: 'main',
      parent: null,
      children: ['n-spacer', 'n-far'],
      classes: [],
      attrs: style('margin: 0'),
    }
    doc.nodes['n-spacer'] = {
      id: 'n-spacer',
      type: 'element',
      tag: 'div',
      parent: 'n-tall',
      children: [],
      classes: [],
      attrs: style('height: 4000px'),
    }
    doc.nodes['n-far'] = {
      id: 'n-far',
      type: 'element',
      tag: 'img',
      parent: 'n-tall',
      children: [],
      classes: [],
      attrs: {
        src: { type: 'asset', asset: 'a-hero' },
        ...style('display: block; width: 400px; height: 300px'),
      },
    }
    await writeFile(path.join(dir, 'lacuno.json'), JSON.stringify(doc))
    const c = await connect(await openFolder(dir), { siteDir: dir, screenshot })
    close = c.close
    const full = await c.client.callTool({
      name: 'page.screenshot',
      arguments: { page: '/tall', width: 800, fullPage: true },
    })
    expect(shot(full).height).toBe(4000)
    const { bytes, height } = shot(
      await c.client.callTool({
        name: 'page.screenshot',
        arguments: { page: '/tall', width: 800, fullPage: true, maxHeight: 4400 },
      }),
    )
    expect(height).toBeGreaterThan(4000)
    // The image's centre, below the 4000px spacer and the body's 8px margin, is the fixture blue,
    // give or take the JPEG's rounding.
    const pixel = await sharp(bytes)
      .extract({ left: 208, top: 4158, width: 1, height: 1 })
      .raw()
      .toBuffer()
    for (const [i, value] of [59, 91, 219].entries()) expect(pixel[i]).toBeCloseTo(value, -1)
  })

  it.skipIf(!chromium)('sends no request beyond the preview origin', async () => {
    let requests = 0
    // Never answers, so a request that got through would also stall the capture.
    const thirdParty = createServer(() => requests++)
    await new Promise<void>((r) => thirdParty.listen(0, '127.0.0.1', r))
    const { port } = thirdParty.address() as AddressInfo
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-mcp-shot-'))
    dirs.push(dir)
    const doc = await writeFixtureSite(dir)
    doc.nodes['n-home']!.children.push('n-beacon')
    doc.nodes['n-beacon'] = {
      id: 'n-beacon',
      type: 'embed',
      parent: 'n-home',
      children: [],
      classes: [],
      html: `<img src="http://127.0.0.1:${port}/pixel.png"><script>fetch('http://127.0.0.1:${port}/beacon')</script>`,
    }
    await writeFile(path.join(dir, 'lacuno.json'), JSON.stringify(doc))
    const c = await connect(await openFolder(dir), { siteDir: dir, screenshot })
    close = c.close
    try {
      shot(await c.client.callTool({ name: 'page.screenshot', arguments: { page: '/' } }))
      expect(requests).toBe(0)
    } finally {
      thirdParty.closeAllConnections()
      thirdParty.close()
    }
  })
})
