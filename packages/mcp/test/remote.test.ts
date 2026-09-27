import type { ApplyResult, Batch } from '@lacuno/document'
import { DocumentStore } from '@lacuno/document'
import { fixtureDocument } from '@lacuno/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { connect, jsonOf } from './helpers.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
})

describe('tools for a server without a site folder', () => {
  it('imports inline data and refuses a path', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const asset = jsonOf<{ id: string; size: number }>(
      await c.client.callTool({
        name: 'asset.import',
        arguments: {
          name: 'note.txt',
          mime: 'text/plain',
          data: Buffer.from('hi').toString('base64'),
        },
      }),
    )
    expect(asset.size).toBe(2)
    expect(store.read().document.assets[asset.id]).toMatchObject({ name: 'note.txt' })
    const byPath = await c.client.callTool({
      name: 'asset.import',
      arguments: { name: 'x', mime: 'text/plain', path: 'x.txt' },
    })
    expect(jsonOf(byPath)).toMatchObject({ kind: 'input' })
  })

  it("hands files to the endpoint's own import: downloaded, inline or by upload address", async () => {
    const imported: unknown[] = []
    const c = await connect(DocumentStore.inMemory(fixtureDocument()), {
      fetchUrl: async (url) => new TextEncoder().encode(url),
      importAsset: async (asset) => {
        imported.push({ ...asset, bytes: Buffer.from(asset.bytes).toString() })
        return { id: 'a-1', name: asset.name, kind: 'image', hash: 'h', mime: 'image/png', size: 1 }
      },
      uploadUrl: (asset) => ({
        url: `https://editor.test/upload/${asset.name}`,
        expiresAt: 'soon',
      }),
    })
    close = c.close
    const url = 'https://images.test/a.png'
    await c.client.callTool({ name: 'asset.import', arguments: { name: 'a.png', url, alt: 'A' } })
    await c.client.callTool({
      name: 'asset.import',
      arguments: { name: 'b.png', mime: 'text/html', data: Buffer.from('b').toString('base64') },
    })
    expect(imported).toEqual([
      { name: 'a.png', alt: 'A', bytes: url },
      { name: 'b.png', bytes: 'b' },
    ])
    const upload = await c.client.callTool({ name: 'asset.upload', arguments: { name: 'c.png' } })
    expect(jsonOf(upload)).toEqual({ url: 'https://editor.test/upload/c.png', expiresAt: 'soon' })
    const both = await c.client.callTool({
      name: 'asset.import',
      arguments: { name: 'd.png', url, data: 'ZA==' },
    })
    expect(jsonOf(both)).toMatchObject({ kind: 'input' })
  })

  it('offers site.publish instead of site.build and reports committed batches', async () => {
    const names: (string | undefined)[] = []
    const applied: [Batch, ApplyResult][] = []
    const c = await connect(DocumentStore.inMemory(fixtureDocument()), {
      publish: async (name) => {
        names.push(name)
        return { url: 'http://testing.example.test/' }
      },
      onApply: (batch, result) => applied.push([batch, result]),
    })
    close = c.close
    const tools = (await c.client.listTools()).tools.map((t) => t.name)
    expect(tools).toContain('site.publish')
    expect(tools).not.toContain('site.build')
    const published = await c.client.callTool({ name: 'site.publish', arguments: { name: 'Hero' } })
    expect(jsonOf(published)).toEqual({ url: 'http://testing.example.test/' })
    expect(names).toEqual(['Hero'])

    const operations = [{ type: 'class.create', id: 'c-x', name: 'x' }]
    await c.client.callTool({
      name: 'document.apply',
      arguments: { expectedRevision: 0, operations, dryRun: true },
    })
    await c.client.callTool({
      name: 'document.apply',
      arguments: { expectedRevision: 0, operations },
    })
    expect(applied).toHaveLength(1)
    expect(applied[0]?.[0].operations).toEqual(operations)
    expect(applied[0]?.[1].revision).toBe(1)
  })
})
