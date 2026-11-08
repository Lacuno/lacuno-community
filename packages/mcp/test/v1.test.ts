import { DocumentStore } from '@lacuno/document'
import { fixtureDocument } from '@lacuno/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { V1_OPERATIONS } from '../src/guide.js'
import { connect, jsonOf, textOf } from './helpers.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
})

/** A server as the apps connected before v2 know it: document.apply and guide's schemas. */
async function v1(store = DocumentStore.inMemory(fixtureDocument())) {
  const c = await connect(store, { version: 1 })
  close = c.close
  return { client: c.client, store }
}

describe('v1: document.apply', () => {
  it('applies a batch, reports created ids, and rejects a stale revision', async () => {
    const { client, store } = await v1()
    const res = jsonOf<{
      revision: number
      created: Record<string, string[]>
      patches?: unknown[]
    }>(
      await client.callTool({
        name: 'document.apply',
        arguments: {
          expectedRevision: 0,
          operations: [
            { type: 'class.create', id: 'c-x', name: 'x' },
            {
              type: 'style.set',
              class: 'c-x',
              breakpoint: 'base',
              state: 'none',
              property: 'color',
              value: { type: 'color', value: 'red' },
            },
          ],
        },
      }),
    )
    expect(res.revision).toBe(1)
    expect(res.created['0']).toEqual(['c-x'])
    expect(res.patches).toBeUndefined()
    expect(store.read().document.classes['c-x']).toBeDefined()
    const stale = await client.callTool({
      name: 'document.apply',
      arguments: { expectedRevision: 0, operations: [] },
    })
    expect(stale.isError).toBe(true)
    expect(jsonOf(stale)).toMatchObject({ kind: 'stale', expected: 0, current: 1 })
  })

  it('returns structured operation errors and supports dry runs', async () => {
    const { client, store } = await v1()
    const err = await client.callTool({
      name: 'document.apply',
      arguments: { expectedRevision: 0, operations: [{ type: 'class.delete', id: 'c-button' }] },
    })
    expect(jsonOf(err)).toMatchObject({
      kind: 'operation',
      index: 0,
      type: 'class.delete',
      referencedBy: ['classes.c-button-primary', 'nodes.n-hero-cta'],
    })
    const dry = jsonOf<{ revision: number; patches: unknown[] }>(
      await client.callTool({
        name: 'document.apply',
        arguments: {
          expectedRevision: 0,
          dryRun: true,
          operations: [{ type: 'node.delete', id: 'n-hero' }],
        },
      }),
    )
    expect(dry.revision).toBe(0)
    expect(dry.patches).toHaveLength(6)
    expect(store.read().document.nodes['n-hero']).toBeDefined()
  })

  it('rejects an operation that fails schema validation, naming its index and field', async () => {
    const { client } = await v1()
    const bad = await client.callTool({
      name: 'document.apply',
      arguments: { expectedRevision: 0, operations: [{ type: 'node.create' }] },
    })
    expect(bad.isError).toBe(true)
    expect(jsonOf(bad)).toMatchObject({
      kind: 'operation',
      index: 0,
      type: 'node.create',
      message: expect.stringContaining('invalid input: parent'),
    })
  })

  it('takes keyframe styles as CSS values, as the operation does', async () => {
    const { client } = await v1()
    const raw = (value: string) => ({ type: 'raw', value })
    const res = jsonOf<{ warnings?: unknown[] }>(
      await client.callTool({
        name: 'document.apply',
        arguments: {
          expectedRevision: 0,
          operations: [
            {
              type: 'keyframes.create',
              id: 'drift',
              stops: [{ at: 0, styles: { opacity: raw('0'), translate: raw('0 40px') } }],
            },
            { type: 'style.set', class: 'c-step', property: '--lc-scroll', value: raw('drift') },
          ],
        },
      }),
    )
    expect(res.warnings ?? []).toEqual([])
    const html = textOf(
      await client.callTool({ name: 'page.preview', arguments: { page: '/', css: true } }),
    )
    expect(html).toContain('@keyframes drift {\n  0% { opacity: 0; translate: 0 40px; }\n}')
    const motion = textOf(await client.callTool({ name: 'guide', arguments: { group: 'motion' } }))
    expect(motion).toContain('"opacity":{"type":"raw","value":"0"}')
  })

  it('says in the answer that a script in an embed is not editable', async () => {
    const { client } = await v1()
    const embed = (expectedRevision: number, id: string, html: string) =>
      client.callTool({
        name: 'document.apply',
        arguments: {
          expectedRevision,
          operations: [
            { type: 'node.create', parent: 'n-home', node: { type: 'embed', id, html } },
          ],
        },
      })
    const plain = jsonOf<{ revision: number; note?: string }>(await embed(0, 'n-quote', '<hr>'))
    expect(plain.note).toBeUndefined()
    const scripted = jsonOf<{ note?: string }>(
      await embed(plain.revision, 'n-menu', '<script>document.body.dataset.open = ""</script>'),
    )
    expect(scripted.note).toContain('guide menu')
  })

  it('refuses asset.create and points at asset.import', async () => {
    const { client } = await v1()
    const result = await client.callTool({
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
})

describe('v1: guide and resources', () => {
  it('lists its tools and names every operation in the guide', async () => {
    const { client } = await v1()
    const tools = (await client.listTools()).tools.map((t) => t.name).sort()
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
      'translations.apply',
      'translations.list',
    ])
    const guide = textOf(await client.callTool({ name: 'guide', arguments: {} }))
    for (const op of V1_OPERATIONS) expect(guide).toContain(op.type)
    // asset.create registers bytes that may not exist; only asset.import is offered.
    expect(guide).not.toContain('asset.create')
    expect(guide).toContain('expectedRevision')
    expect(guide).toContain('Call guide with a group to get the schemas.')
    expect(guide).toContain('keyframes: keyframes.create, keyframes.update, keyframes.delete')
    // The basics stay short; the how-to lives in topics.
    expect(guide.split(/\s+/).length).toBeLessThan(450)
    expect(
      textOf(await client.callTool({ name: 'guide', arguments: { group: 'menu' } })),
    ).toContain('popovertarget')
    // Every host reads the instructions the connection opens with, skills or not.
    expect(client.getInstructions()).toContain('guide is a reference')
    expect(client.getInstructions()).toContain('document.apply')
    const nodesOnly = textOf(await client.callTool({ name: 'guide', arguments: { group: 'node' } }))
    expect(nodesOnly).toContain('### node.create')
    expect(nodesOnly).not.toContain('### style.set')
    // Shared parts are written once: this group was about 75,000 characters.
    expect(nodesOnly.length).toBeLessThan(15_000)
    const bad = await client.callTool({ name: 'guide', arguments: { group: 'nope' } })
    expect(bad.isError).toBe(true)
    expect(JSON.parse(textOf(bad))).toMatchObject({ kind: 'input' })
  })

  it('keeps the declared tool schemas small', async () => {
    const { client } = await v1()
    const size = Buffer.byteLength(JSON.stringify(await client.listTools()), 'utf8')
    // The annotations on every tool take about a kilobyte of it, the two translation tools 1.5.
    expect(size).toBeLessThan(8500)
  })

  it('serves the document and operation schemas as resources', async () => {
    const { client } = await v1()
    const uris = (await client.listResources()).resources.map((r) => r.uri).sort()
    expect(uris).toEqual(['lacuno://schema/document', 'lacuno://schema/operations'])
    const ops = await client.readResource({ uri: 'lacuno://schema/operations' })
    const schema = JSON.parse((ops.contents[0] as { text: string }).text) as {
      anyOf?: unknown[]
      oneOf?: unknown[]
    }
    expect((schema.anyOf ?? schema.oneOf ?? []).length).toBe(V1_OPERATIONS.length)
    expect(JSON.stringify(schema)).not.toContain('asset.create')
  })
})
