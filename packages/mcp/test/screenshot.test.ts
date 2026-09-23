import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeFixtureSite } from '@freeflow/compiler/build'
import { DocumentStore } from '@freeflow/document'
import { afterEach, describe, expect, it } from 'vitest'
import { connect } from './helpers.js'

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

function png(result: Record<string, unknown>): { width: number; height: number } {
  const [image, size] = result.content as Content[]
  expect(image?.mimeType).toBe('image/png')
  const bytes = Buffer.from(image?.data ?? '', 'base64')
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const out = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
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
})
