import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { writeFixtureSite } from '@freeflow/compiler/build'
import { DocumentStore } from '@freeflow/document'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

const dirs: string[] = []
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

type Content = { type: string; data?: string; mimeType?: string; text?: string }

function png(result: Record<string, unknown>): { width: number; height: number; bytes: Buffer } {
  const [image, size] = result.content as Content[]
  expect(image?.mimeType).toBe('image/png')
  const bytes = Buffer.from(image?.data ?? '', 'base64')
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const out = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes }
  expect(size?.text).toBe(`${out.width}×${out.height}`)
  return out
}

describe('page.screenshot', () => {
  it.skipIf(!chromium)('captures the page at the viewport width and crops to a node', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-mcp-shot-'))
    dirs.push(dir)
    await writeFixtureSite(dir)
    const c = await connect(await DocumentStore.open(dir), { siteDir: dir })
    close = c.close
    const page = png(
      await c.client.callTool({ name: 'page.screenshot', arguments: { page: '/', width: 800 } }),
    )
    expect(page.width).toBe(800)
    const node = png(
      await c.client.callTool({
        name: 'page.screenshot',
        arguments: { page: '/', width: 800, node: 'n-hero-title' },
      }),
    )
    expect(node.width * node.height).toBeLessThan(page.width * page.height)
  })

  it.skipIf(!chromium)('captures lazy images far below the fold', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-mcp-shot-'))
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
    await writeFile(path.join(dir, 'freeflow.json'), JSON.stringify(doc))
    const c = await connect(await DocumentStore.open(dir), { siteDir: dir })
    close = c.close
    const { bytes } = png(
      await c.client.callTool({
        name: 'page.screenshot',
        arguments: { page: '/tall', width: 800 },
      }),
    )
    // The image's centre, below the 4000px spacer and the body's 8px margin, is the fixture blue.
    const pixel = await sharp(bytes)
      .extract({ left: 208, top: 4158, width: 1, height: 1 })
      .raw()
      .toBuffer()
    expect([...pixel.subarray(0, 3)]).toEqual([59, 91, 219])
  })

  it.skipIf(!chromium)('sends no request beyond the preview origin', async () => {
    let requests = 0
    // Never answers, so a request that got through would also stall the capture.
    const thirdParty = createServer(() => requests++)
    await new Promise<void>((r) => thirdParty.listen(0, '127.0.0.1', r))
    const { port } = thirdParty.address() as AddressInfo
    const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-mcp-shot-'))
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
    await writeFile(path.join(dir, 'freeflow.json'), JSON.stringify(doc))
    const c = await connect(await DocumentStore.open(dir), { siteDir: dir })
    close = c.close
    try {
      png(await c.client.callTool({ name: 'page.screenshot', arguments: { page: '/' } }))
      expect(requests).toBe(0)
    } finally {
      thirdParty.closeAllConnections()
      thirdParty.close()
    }
  })
})
