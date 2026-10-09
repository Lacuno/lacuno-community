import { DocumentStore } from '@lacuno/document'
import { fixtureDocument } from '@lacuno/schema'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import type { Box, Screenshot, ScreenshotOptions } from '../src/screenshot.js'
import { connect, jsonOf } from './helpers.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
})

const jpeg = (width: number) =>
  sharp({ create: { width, height: 600, channels: 3, background: '#fff' } })
    .jpeg()
    .toBuffer()

const box = (id: string, tag: string, depth: number): Box => ({
  id,
  tag,
  depth,
  x: depth * 10,
  y: depth * 10,
  w: 100,
  h: 50,
})

/** A screenshot that measures nothing and answers `boxes` instead. */
function fake(boxes: Box[]) {
  const calls: { html: string; options: ScreenshotOptions }[] = []
  const screenshot: Screenshot = async (html, _assetAt, options) => {
    calls.push({ html, options })
    const image = await jpeg(options.width)
    return options.boxes ? { image, boxes } : image
  }
  return { screenshot, calls }
}

type View = {
  site: string
  page: { id: string; name: string; path: string }
  width: number
  height: number
  boxes: (Box & { label: string })[]
}

describe('page.view', () => {
  it('answers the boxes with labels from names, then tags, and the same image', async () => {
    const doc = fixtureDocument()
    doc.nodes['n-hero']!.meta = { label: 'Hero' }
    const { screenshot, calls } = fake([
      box('n-home', 'main', 0),
      box('n-hero', 'section', 1),
      box('n-hero-title', 'h1', 3),
    ])
    const c = await connect(DocumentStore.inMemory(doc), {
      screenshot,
      assets: async () => undefined,
    })
    close = c.close
    const tool = (await c.client.listTools()).tools.find((t) => t.name === 'page.view')
    expect(tool?._meta).toEqual({ ui: { resourceUri: 'ui://lacuno/page-view' } })
    expect(tool?.annotations?.readOnlyHint).toBe(true)
    const result = await c.client.callTool({ name: 'page.view', arguments: { page: '/' } })
    const view = jsonOf<View>(result)
    const home = Object.values(doc.pages).find((p) => p.path === '/')!
    expect(view).toMatchObject({
      site: doc.site.name,
      page: { id: home.id, name: home.name, path: '/' },
      width: 1280,
      height: 600,
    })
    expect(view.boxes.map((b) => [b.id, b.label, b.depth])).toEqual([
      ['n-home', 'main', 0],
      ['n-hero', 'Hero', 1],
      ['n-hero-title', 'h1', 3],
    ])
    const [, image] = result.content as { type: string; data?: string; mimeType?: string }[]
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/jpeg' })
    expect(Buffer.from(image?.data ?? '', 'base64')).toEqual(await jpeg(1280))
    // The whole page, annotated so the renderer finds the nodes, at the asked width.
    expect(calls[0]?.options).toEqual({ width: 1280, boxes: true })
    expect(calls[0]?.html).toContain('data-lacuno-node="n-hero"')
    await c.client.callTool({ name: 'page.view', arguments: { page: '/', width: 390 } })
    expect(calls[1]?.options.width).toBe(390)
  })

  it('keeps the 400 shallowest boxes, in document order', async () => {
    const boxes = Array.from({ length: 500 }, (_, i) => box(`n-${i}`, 'div', i % 5))
    const { screenshot } = fake(boxes)
    const c = await connect(DocumentStore.inMemory(fixtureDocument()), {
      screenshot,
      assets: async () => undefined,
    })
    close = c.close
    const view = jsonOf<View>(
      await c.client.callTool({ name: 'page.view', arguments: { page: '/' } }),
    )
    expect(view.boxes).toHaveLength(400)
    expect(view.boxes.every((b) => b.depth < 4)).toBe(true)
    const order = view.boxes.map((b) => Number(b.id.slice(2)))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('is offered with its view only where screenshots are', async () => {
    const without = await connect(DocumentStore.inMemory(fixtureDocument()))
    expect((await without.client.listTools()).tools.map((t) => t.name)).not.toContain('page.view')
    expect((await without.client.listResources()).resources.map((r) => r.uri)).not.toContain(
      'ui://lacuno/page-view',
    )
    await without.close()

    const c = await connect(DocumentStore.inMemory(fixtureDocument()), {
      screenshot: fake([]).screenshot,
    })
    close = c.close
    expect((await c.client.listResources()).resources).toContainEqual(
      expect.objectContaining({
        uri: 'ui://lacuno/page-view',
        mimeType: 'text/html;profile=mcp-app',
      }),
    )
    const { contents } = await c.client.readResource({ uri: 'ui://lacuno/page-view' })
    expect(contents[0]).toMatchObject({
      uri: 'ui://lacuno/page-view',
      mimeType: 'text/html;profile=mcp-app',
    })
    const html = (contents[0] as { text: string }).text
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain("'ui/initialize'")
    // Nothing fetched: the host's CSP allows no network beyond the result's data URI.
    expect(html).not.toMatch(/\b(src|href)="https?:/)
  })
})
