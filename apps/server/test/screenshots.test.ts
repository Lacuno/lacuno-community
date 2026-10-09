import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { serve } from '@hono/node-server'
import { writeFixtureSite } from '@lacuno/compiler/build'
import { DocumentStore } from '@lacuno/document'
import { createServer } from '@lacuno/mcp'
import { imageInfo, serviceScreenshot } from '@lacuno/mcp/screenshot'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Hono } from 'hono'
import sharp from 'sharp'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { screenshotService } from '../src/screenshot-service.js'

// Chromium already refuses loopback requests from a public page; lifting that lets a local server
// stand in for a third party.
vi.mock('playwright', async (importOriginal) => {
  const pw = await importOriginal<typeof import('playwright')>()
  const args = ['--disable-features=LocalNetworkAccessChecks']
  return { ...pw, chromium: { launch: () => pw.chromium.launch({ args }) } }
})

const chromium = await import('playwright')
  .then(({ chromium }) => chromium.launch())
  .then((browser) => browser.close())
  .then(() => true)
  .catch(() => false)

const secret = 'test-screenshot-secret'
const service = screenshotService({ slots: 1, secret, wait: 1500 })
const listener = serve({ fetch: service.fetch, port: 0, hostname: '127.0.0.1' })
await new Promise((resolve) => listener.once('listening', resolve))
const url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}`
afterAll(() => {
  listener.close()
})

const red = await sharp({
  create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } },
})
  .png()
  .toBuffer()

function shoot(
  html: string,
  request: object,
  assets: Record<string, Buffer> = {},
  authorization = `Bearer ${secret}`,
) {
  const form = new FormData()
  form.set('request', JSON.stringify(request))
  form.set('html', html)
  for (const [name, body] of Object.entries(assets))
    form.set(`asset:${name}`, new Blob([new Uint8Array(body)], { type: 'image/png' }))
  return service.request('/screenshot', { method: 'POST', body: form, headers: { authorization } })
}

/** Holds the one slot for about `ms` by blocking the page's load. */
const slow = (ms: number) =>
  `<script>const end = Date.now() + ${ms}; while (Date.now() < end);</script>`

describe.skipIf(!chromium)('screenshot service', () => {
  it('renders a page with its assets and crops to a node', async () => {
    expect((await service.request('/health')).status).toBe(200)
    const page = await shoot(
      '<body style="margin:0"><img src="/assets/red.png" style="width:100px;height:100px">',
      { width: 200, height: 150 },
      { '/assets/red.png': red },
    )
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toBe('image/jpeg')
    const jpeg = Buffer.from(await page.arrayBuffer())
    expect(imageInfo(jpeg)).toEqual({ mime: 'image/jpeg', width: 200, height: 150 })
    const pixel = await sharp(jpeg)
      .extract({ left: 50, top: 50, width: 1, height: 1 })
      .raw()
      .toBuffer()
    for (const [i, value] of [255, 0, 0].entries()) expect(pixel[i]).toBeCloseTo(value, -1)

    const html = '<div data-lacuno-node="n-box" style="width:120px;height:30px">Box</div>'
    const node = await shoot(html, { width: 400, node: 'n-box' })
    expect(node.headers.get('content-type')).toBe('image/png')
    expect(imageInfo(Buffer.from(await node.arrayBuffer()))).toEqual({
      mime: 'image/png',
      width: 120,
      height: 30,
    })
    const unknown = await shoot(html, { width: 400, node: 'n-missing' })
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toEqual({ error: 'node n-missing is not rendered on this page' })
  })

  it('measures the boxes of annotated nodes and answers them as JSON', async () => {
    const html =
      '<body style="margin:0"><main data-lacuno-node="n-home"><section data-lacuno-node="n-hero" style="height:200px">Hero</section><p data-lacuno-node="n-hidden" style="display:none"></p></main>'
    const response = await shoot(html, { width: 500, height: 300, boxes: true })
    expect(response.headers.get('content-type')).toContain('application/json')
    const { image, mime, boxes } = (await response.json()) as {
      image: string
      mime: string
      boxes: unknown[]
    }
    expect(mime).toBe('image/jpeg')
    expect(imageInfo(Buffer.from(image, 'base64'))).toEqual({
      mime: 'image/jpeg',
      width: 500,
      height: 300,
    })
    // Only nodes with an area, in document order, with their annotated ancestors counted.
    expect(boxes).toEqual([
      { id: 'n-home', tag: 'main', depth: 0, x: 0, y: 0, w: 500, h: 200 },
      { id: 'n-hero', tag: 'section', depth: 1, x: 0, y: 0, w: 500, h: 200 },
    ])
    const through = await serviceScreenshot(url, secret)(html, async () => undefined, {
      width: 500,
      height: 300,
      boxes: true,
    })
    expect(Buffer.isBuffer(through)).toBe(false)
    expect(through).toMatchObject({ image: Buffer.from(image, 'base64'), boxes })
  })

  it('refuses bad input and a missing secret', async () => {
    expect((await shoot('<p>Hi</p>', { width: 400 }, {}, 'Bearer wrong')).status).toBe(401)
    expect((await shoot('<p>Hi</p>', { width: 0 })).status).toBe(400)
  })

  it('queues beyond its slots and answers 503 after the wait', async () => {
    const viewport = { width: 400, height: 300 }
    // The quick page asks once the slow one holds the only slot.
    const slowAndQuick = async (ms: number) => {
      const first = shoot(slow(ms), viewport)
      await sleep(300)
      return [await shoot('<p>Hi</p>', viewport), await first]
    }
    expect((await slowAndQuick(800)).map((r) => r.status)).toEqual([200, 200])
    const [busy, held] = await slowAndQuick(3000)
    expect(held?.status).toBe(200)
    expect(busy?.status).toBe(503)
    expect(await busy?.json()).toEqual({ error: 'Screenshots are busy.', retryAfter: 5 })
  })

  it('sends no request beyond the page', async () => {
    let requests = 0
    // Never answers, so a request that got through would also stall the capture.
    const thirdParty = createHttpServer(() => requests++)
    await new Promise<void>((r) => thirdParty.listen(0, '127.0.0.1', r))
    const { port } = thirdParty.address() as AddressInfo
    try {
      const html = `<img src="http://127.0.0.1:${port}/pixel.png"><script>fetch('http://127.0.0.1:${port}/beacon')</script>`
      expect((await shoot(html, { width: 400, height: 300 })).status).toBe(200)
      expect(requests).toBe(0)
    } finally {
      thirdParty.closeAllConnections()
      thirdParty.close()
    }
  })

  it("takes page.screenshot through the service with only the page's assets", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-screenshots-'))
    try {
      const doc = await writeFixtureSite(dir)
      const unused = { ...Object.values(doc.assets)[0]!, id: 'a-unused', hash: 'f'.repeat(64) }
      doc.assets[unused.id] = unused
      const read: string[] = []
      const mcp = createServer(DocumentStore.inMemory(doc), {
        assets: (hash) => {
          read.push(hash)
          return readFile(path.join(dir, 'assets', hash)).catch(() => undefined)
        },
        screenshot: serviceScreenshot(url, secret),
      })
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      await mcp.connect(serverTransport)
      const client = new Client({ name: 'test', version: '0.0.0' })
      await client.connect(clientTransport)
      const result = await client.callTool({
        name: 'page.screenshot',
        arguments: { page: '/', width: 600, height: 400 },
      })
      const [image, size] = result.content as { mimeType?: string; text?: string }[]
      expect(image?.mimeType).toBe('image/jpeg')
      expect(size?.text).toBe('600×400')
      expect(read.length).toBeGreaterThan(0)
      expect(read).not.toContain(unused.hash)
      await client.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('the screenshot client', () => {
  it('sends only the referenced assets and turns a full service into a busy error', async () => {
    const parts: string[] = []
    const fake = new Hono().post('/screenshot', async (c) => {
      const form = await c.req.formData()
      form.forEach((_, key) => {
        parts.push(key)
      })
      return c.json({ error: 'Screenshots are busy.', retryAfter: 5 }, 503)
    })
    const fakeListener = serve({ fetch: fake.fetch, port: 0, hostname: '127.0.0.1' })
    await new Promise((resolve) => fakeListener.once('listening', resolve))
    const asked: string[] = []
    try {
      const take = serviceScreenshot(
        `http://127.0.0.1:${(fakeListener.address() as AddressInfo).port}`,
        undefined,
      )
      const html = '<img src="/assets/a.png"><img src="/assets/a.png"><img src="/assets/gone.png">'
      await expect(
        take(
          html,
          async (path) => {
            asked.push(path)
            return path === '/assets/a.png' ? { mime: 'image/png', body: red } : undefined
          },
          { width: 400 },
        ),
      ).rejects.toThrow('Screenshots are busy. Try again in a few seconds.')
    } finally {
      fakeListener.close()
    }
    expect(asked).toEqual(['/assets/a.png', '/assets/gone.png'])
    expect(parts).toEqual(['request', 'html', 'asset:/assets/a.png'])
  })
})
