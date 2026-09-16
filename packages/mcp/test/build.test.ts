import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DocumentStore } from '@freeflow/document'
import { afterEach, describe, expect, it } from 'vitest'
import { connect, jsonOf } from './helpers.js'

const dirs: string[] = []
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('asset.import and site.build', () => {
  it('imports from a path and from base64, then builds', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-mcp-'))
    dirs.push(dir)
    const store = await DocumentStore.create(dir, 'Site')
    const c = await connect(store, { siteDir: dir })
    close = c.close
    const file = path.join(dir, 'note.txt')
    await writeFile(file, 'hello')
    const a = jsonOf<{ id: string; hash: string; kind: string }>(
      await c.client.callTool({
        name: 'asset.import',
        arguments: { name: 'note.txt', mime: 'text/plain', path: file },
      }),
    )
    expect(a.kind).toBe('file')
    expect(existsSync(path.join(dir, 'assets', a.hash))).toBe(true)
    const b = jsonOf<{ size: number }>(
      await c.client.callTool({
        name: 'asset.import',
        arguments: {
          name: 'b.txt',
          mime: 'text/plain',
          base64: Buffer.from('xy').toString('base64'),
        },
      }),
    )
    expect(b.size).toBe(2)
    const both = await c.client.callTool({
      name: 'asset.import',
      arguments: { name: 'c', mime: 'text/plain', path: file, base64: 'eA==' },
    })
    expect(jsonOf(both)).toMatchObject({ kind: 'input' })
    const built = jsonOf<{ pages: number; outDir: string }>(
      await c.client.callTool({ name: 'site.build', arguments: {} }),
    )
    expect(built.pages).toBe(1)
    expect(existsSync(path.join(built.outDir, 'index.html'))).toBe(true)
  })

  it('site.build fails with kind input on an in-memory store', async () => {
    const { fixtureDocument } = await import('@freeflow/schema')
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    expect(jsonOf(await c.client.callTool({ name: 'site.build', arguments: {} }))).toMatchObject({
      kind: 'input',
    })
  })
})
