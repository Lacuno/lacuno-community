import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build, writeFixtureSite } from '@freeflow/compiler/build'
import { DocumentStore } from '@freeflow/document'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureOperations } from '../../document/test/fixture-operations.js'
import { connect, jsonOf } from './helpers.js'

const dirs: string[] = []
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('building the fixture site through MCP', () => {
  it('matches the compiler building the fixture directly', async () => {
    const a = await mkdtemp(path.join(os.tmpdir(), 'freeflow-mcp-a-'))
    dirs.push(a)
    const b = await mkdtemp(path.join(os.tmpdir(), 'freeflow-mcp-b-'))
    dirs.push(b)
    const store = await DocumentStore.create(a, 'Fixture Co')
    const c = await connect(store, { siteDir: a })
    close = c.close
    const initialPage = Object.keys(store.read().document.pages)[0] as string
    const png = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#3b5bdb' },
    })
      .png()
      .toBuffer()
    const asset = jsonOf<{ id: string; hash: string }>(
      await c.client.callTool({
        name: 'asset.import',
        arguments: {
          name: 'hero.png',
          mime: 'image/png',
          base64: png.toString('base64'),
          alt: 'Hero image',
          width: 1200,
          height: 800,
        },
      }),
    )
    // The fixture registers a-hero itself; replace that operation with an update that points at the imported asset id.
    const ops = fixtureOperations(initialPage)
      .filter((o) => o.type !== 'asset.create')
      .map((o) => JSON.parse(JSON.stringify(o).replaceAll('"a-hero"', `"${asset.id}"`)))
    const applied = jsonOf<{ revision: number }>(
      await c.client.callTool({
        name: 'document.apply',
        arguments: { expectedRevision: store.revision, operations: ops },
      }),
    )
    expect(applied.revision).toBe(2)
    const built = jsonOf<{ pages: number; outDir: string }>(
      await c.client.callTool({
        name: 'site.build',
        arguments: { siteUrl: 'https://example.com' },
      }),
    )
    expect(built.pages).toBe(4)

    await writeFixtureSite(b)
    const direct = await build(b, { quiet: true, siteUrl: 'https://example.com' })
    for (const page of ['index.html', 'blog/hello-world/index.html']) {
      const viaMcp = await readFile(path.join(built.outDir, page), 'utf8')
      const viaCompiler = await readFile(path.join(direct.outDir, page), 'utf8')
      expect(viaMcp.replace(/[a-f0-9]{64}/g, 'HASH')).toBe(
        viaCompiler.replace(/[a-f0-9]{64}/g, 'HASH'),
      )
    }
  })
})
