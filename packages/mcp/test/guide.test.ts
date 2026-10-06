import { DocumentStore } from '@lacuno/document'
import { fixtureDocument } from '@lacuno/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { MCP_OPERATIONS } from '../src/guide.js'
import { connect, jsonOf, textOf } from './helpers.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
})

describe('guide and resources', () => {
  it('lists every tool and names every operation in the guide', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const tools = (await c.client.listTools()).tools.map((t) => t.name).sort()
    expect(tools).toEqual([
      'asset.import',
      'document.apply',
      'document.diff',
      'document.read',
      'entries.list',
      'guide',
      'node.get',
      'page.outline',
      'page.preview',
      'site.build',
      'styles.get',
    ])
    const guide = textOf(await c.client.callTool({ name: 'guide', arguments: {} }))
    for (const op of MCP_OPERATIONS) expect(guide).toContain(op.type)
    // asset.create registers bytes that may not exist; only asset.import is offered.
    expect(guide).not.toContain('asset.create')
    expect(guide).toContain('expectedRevision')
    expect(guide).toContain('page.preview')
    expect(guide).toContain('Call guide with a group to get the schemas.')
    expect(guide).toContain('bulletList')
    expect(guide).toContain('attrs.href')
    const nodesOnly = textOf(
      await c.client.callTool({ name: 'guide', arguments: { group: 'node' } }),
    )
    expect(nodesOnly).toContain('### node.create')
    expect(nodesOnly).not.toContain('### style.set')
    const bad = await c.client.callTool({ name: 'guide', arguments: { group: 'nope' } })
    expect(bad.isError).toBe(true)
    expect(JSON.parse(textOf(bad))).toMatchObject({ kind: 'input' })
  })

  it('keeps the declared tool schemas small', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const size = Buffer.byteLength(JSON.stringify(await c.client.listTools()), 'utf8')
    expect(size).toBeLessThan(5500)
  })

  it('refuses asset.create and points at asset.import', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const result = await c.client.callTool({
      name: 'document.apply',
      arguments: {
        expectedRevision: 0,
        operations: [
          {
            type: 'asset.create',
            id: 'a-x',
            name: 'x.png',
            kind: 'image',
            hash: 'ff',
            mime: 'image/png',
            size: 1,
          },
        ],
      },
    })
    expect(result.isError).toBe(true)
    expect(jsonOf<{ kind: string; message: string }>(result)).toMatchObject({
      kind: 'input',
      message: expect.stringContaining('asset.import'),
    })
  })

  it('serves the document and operation schemas as resources', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const uris = (await c.client.listResources()).resources.map((r) => r.uri).sort()
    expect(uris).toEqual(['lacuno://schema/document', 'lacuno://schema/operations'])
    const ops = await c.client.readResource({ uri: 'lacuno://schema/operations' })
    const schema = JSON.parse((ops.contents[0] as { text: string }).text) as {
      anyOf?: unknown[]
      oneOf?: unknown[]
    }
    expect((schema.anyOf ?? schema.oneOf ?? []).length).toBe(MCP_OPERATIONS.length)
    expect(JSON.stringify(schema)).not.toContain('asset.create')
  })
})
