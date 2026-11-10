import { DocumentStore } from '@lacuno/document'
import { fixtureDocument } from '@lacuno/schema'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { afterEach, describe, expect, it } from 'vitest'
import { MCP_OPERATIONS } from '../src/guide.js'
import { connect, jsonOf } from './helpers.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
})

describe('tools and resources', () => {
  it('lists every tool, none of them a guide, and says how to work where every app reads it', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const { tools } = await c.client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'asset.import',
        'document.read',
        'entries.list',
        'node.get',
        'page.outline',
        'page.preview',
        'styles.get',
        'translations.apply',
        'translations.list',
        ...MCP_OPERATIONS.map((o) => o.type),
      ].sort(),
    )
    // No tool answers how to work: the instructions a connection opens with say it, skills or
    // not, and each tool's description says what nobody could guess about it.
    expect(JSON.stringify(tools)).not.toMatch(/\bguide\b|document\.apply/)
    const instructions = c.client.getInstructions()
    expect(instructions).toContain('node.create')
    expect(instructions).toContain('prefix them by kind')
    expect(instructions).not.toMatch(/\bguide\b|document\.apply/)
    const described = (name: string) => tools.find((tool) => tool.name === name)?.description
    expect(described('style.set')).toContain('--lc-entrance')
    expect(described('style.set')).toContain('lc-parallax')
    expect(described('node.create')).toContain('Tiptap')
    expect(described('node.create')).toContain('A form without an action')
    expect(described('component.create')).toContain('slot node')
    expect(described('collection.create')).toContain('collection-list')
    expect(described('page.create')).toContain('/404')
  })

  it('says in the answer that a script in an embed is not editable', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const embed = (expectedRevision: number, id: string, html: string) =>
      c.client.callTool({
        name: 'node.create',
        arguments: {
          expectedRevision,
          changes: [{ parent: 'n-home', node: { type: 'embed', id, html } }],
        },
      })
    const plain = jsonOf<{ revision: number; note?: string }>(await embed(0, 'n-quote', '<hr>'))
    expect(plain.note).toBeUndefined()
    const scripted = jsonOf<{ note?: string }>(
      await embed(plain.revision, 'n-menu', '<script>document.body.dataset.open = ""</script>'),
    )
    expect(scripted.note).toContain('popovertarget')
  })

  it('keeps the declared tool schemas within their budget', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const size = Buffer.byteLength(JSON.stringify(await c.client.listTools()), 'utf8')
    // One tool per operation, each taking a list of changes: about 71,500 bytes, with lean schemas
    // (leanSchema) whose shared parts are named once (@lacuno/schema) and keyframes as CSS text.
    // A model reads the names, descriptions and schemas, about 61,500 of them (16,000 tokens);
    // the titles and annotations are for the app.
    expect(size).toBeLessThan(74_000)
  })

  it('lists every input as JSON Schema 2020-12, which a schema without $schema is', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const { tools } = await c.client.listTools()
    // A draft-7 tuple, items as a list, made OpenAI's tool scan refuse site.update.
    const ajv = new Ajv2020()
    for (const tool of tools) expect(ajv.validateSchema(tool.inputSchema), tool.name).toBe(true)
    expect(JSON.stringify(tools)).not.toContain('"format":"includes"')
  })

  it('offers no asset.create: asset.import stores the bytes', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const { tools } = await c.client.listTools()
    expect(tools.some((tool) => tool.name === 'asset.create')).toBe(false)
    expect(tools.find((tool) => tool.name === 'asset.update')?.description).toBeTruthy()
  })

  it('serves the document schema as a resource', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const uris = (await c.client.listResources()).resources.map((r) => r.uri).sort()
    expect(uris).toEqual(['lacuno://schema/document'])
  })
})
