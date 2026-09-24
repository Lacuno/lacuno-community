import { existsSync } from 'node:fs'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DocumentStore } from '@miralo/document'
import { createFolder } from '@miralo/document/folder'
import { afterEach, describe, expect, it } from 'vitest'
import { connect, jsonOf } from './helpers.js'

const dirs: string[] = []
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('asset.import and site.build', () => {
  it('rejects a symlink escaping the site while allowing an internal symlink', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'miralo-mcp-links-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'miralo-mcp-outside-'))
    dirs.push(dir, outside)
    await writeFile(path.join(outside, 'private.txt'), 'private')
    await symlink(path.join(outside, 'private.txt'), path.join(dir, 'escape.txt'))
    await writeFile(path.join(dir, 'inside.txt'), 'public')
    await symlink(path.join(dir, 'inside.txt'), path.join(dir, 'alias.txt'))
    const store = await createFolder(dir, 'Links')
    const c = await connect(store, { siteDir: dir })
    close = c.close
    const blocked = await c.client.callTool({
      name: 'asset.import',
      arguments: { name: 'escape', mime: 'text/plain', path: 'escape.txt' },
    })
    expect(blocked.isError).toBe(true)
    expect(store.revision).toBe(0)
    const allowed = await c.client.callTool({
      name: 'asset.import',
      arguments: { name: 'alias', mime: 'text/plain', path: 'alias.txt' },
    })
    expect(allowed.isError).not.toBe(true)
    expect(store.revision).toBe(1)
  })
  it('imports from a path and from data, then builds', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'miralo-mcp-'))
    dirs.push(dir)
    const store = await createFolder(dir, 'Site')
    const c = await connect(store, { siteDir: dir })
    close = c.close
    const file = path.join(dir, 'note.txt')
    await writeFile(file, 'hello')
    const a = jsonOf<{ id: string; hash: string; kind: string }>(
      await c.client.callTool({
        name: 'asset.import',
        arguments: { name: 'note.txt', mime: 'text/plain', path: 'note.txt' },
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
          data: Buffer.from('xy').toString('base64'),
        },
      }),
    )
    expect(b.size).toBe(2)
    const both = await c.client.callTool({
      name: 'asset.import',
      arguments: { name: 'c', mime: 'text/plain', path: 'note.txt', data: 'eA==' },
    })
    expect(jsonOf(both)).toMatchObject({ kind: 'input' })
    const outside = await c.client.callTool({
      name: 'asset.import',
      arguments: { name: 'c', mime: 'text/plain', path: '../outside.txt' },
    })
    expect(outside.isError).toBe(true)
    expect(jsonOf(outside)).toMatchObject({ kind: 'input' })
    const built = jsonOf<{ pages: number; outDir: string }>(
      await c.client.callTool({ name: 'site.build', arguments: {} }),
    )
    expect(built.pages).toBe(1)
    expect(existsSync(path.join(built.outDir, 'index.html'))).toBe(true)
  })

  it('site.build fails with kind input on an in-memory store', async () => {
    const { fixtureDocument } = await import('@miralo/schema')
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    expect(jsonOf(await c.client.callTool({ name: 'site.build', arguments: {} }))).toMatchObject({
      kind: 'input',
    })
  })

  it('serializes overlapping site.build calls so they never run concurrently', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'miralo-mcp-'))
    dirs.push(dir)
    const store = await createFolder(dir, 'Site')
    const c = await connect(store, { siteDir: dir })
    close = c.close
    const [first, second] = await Promise.all([
      c.client.callTool({ name: 'site.build', arguments: {} }),
      c.client.callTool({ name: 'site.build', arguments: {} }),
    ])
    expect(jsonOf<{ pages: number }>(first).pages).toBe(1)
    expect(jsonOf<{ pages: number }>(second).pages).toBe(1)
  })
})
