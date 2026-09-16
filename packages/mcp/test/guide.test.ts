import { DocumentStore, OPERATIONS } from '@freeflow/document'
import { fixtureDocument } from '@freeflow/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { connect, textOf } from './helpers.js'

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
      'document.read',
      'entries.list',
      'guide',
      'node.get',
      'page.outline',
      'site.build',
      'styles.get',
    ])
    const guide = textOf(await c.client.callTool({ name: 'guide', arguments: {} }))
    for (const op of OPERATIONS) expect(guide).toContain(op.type)
    expect(guide).toContain('expectedRevision')
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
    expect(size).toBeLessThan(4000)
  })

  it('serves the document and operation schemas as resources', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const uris = (await c.client.listResources()).resources.map((r) => r.uri).sort()
    expect(uris).toEqual(['freeflow://schema/document', 'freeflow://schema/operations'])
    const ops = await c.client.readResource({ uri: 'freeflow://schema/operations' })
    const schema = JSON.parse((ops.contents[0] as { text: string }).text) as {
      anyOf?: unknown[]
      oneOf?: unknown[]
    }
    expect((schema.anyOf ?? schema.oneOf ?? []).length).toBe(OPERATIONS.length)
  })
})
