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
  it('lists every tool, and the guide has notes only', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const tools = (await c.client.listTools()).tools.map((t) => t.name).sort()
    expect(tools).toEqual(
      [
        'asset.import',
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
        ...MCP_OPERATIONS.map((o) => o.type),
      ].sort(),
    )
    const guide = textOf(await c.client.callTool({ name: 'guide', arguments: {} }))
    expect(guide).toContain('expectedRevision')
    expect(guide).toContain('page.preview')
    expect(guide).not.toContain('document.apply')
    // The basics stay short; the how-to lives in topics.
    expect(guide.split(/\s+/).length).toBeLessThan(450)
    const topic = async (topic: string) =>
      textOf(await c.client.callTool({ name: 'guide', arguments: { topic } }))
    expect(await topic('text')).toContain('bulletList')
    expect(await topic('text')).toContain('attrs.href')
    expect(await topic('menu')).toContain('popovertarget')
    expect(await topic('motion')).toContain('lc-parallax')
    expect(await topic('motion')).toContain('data-lc-story')
    expect(await topic('motion')).toContain('data-lc-scrub')
    expect(await topic('motion')).toContain('-g 1')
    expect(await topic('motion')).toContain('keyframes.create')
    expect(await topic('translate')).toContain('translations.apply')
    expect(await topic('translate')).toContain('glossary')
    for (const name of ['build', 'check', 'looks', 'content', 'forms', 'settings'])
      expect(await topic(name)).toMatch(/^## /)
    // No topic hands out schemas, and none names a batch tool.
    for (const name of ['build', 'check', 'looks', 'text', 'content', 'forms', 'menu', 'motion'])
      expect(await topic(name)).not.toMatch(/document\.apply|batch/)
    expect((await c.client.callTool({ name: 'guide', arguments: { topic: 'node' } })).isError).toBe(
      true,
    )
    // Every host reads the instructions the connection opens with, skills or not.
    const instructions = c.client.getInstructions()
    expect(instructions).toContain('translate')
    expect(instructions).toContain('motion')
    expect(instructions).toContain('node.create')
    expect(instructions).not.toContain('document.apply')
  })

  it('says in the answer that a script in an embed is not editable', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const embed = (expectedRevision: number, id: string, html: string) =>
      c.client.callTool({
        name: 'node.create',
        arguments: { expectedRevision, parent: 'n-home', node: { type: 'embed', id, html } },
      })
    const plain = jsonOf<{ revision: number; note?: string }>(await embed(0, 'n-quote', '<hr>'))
    expect(plain.note).toBeUndefined()
    const scripted = jsonOf<{ note?: string }>(
      await embed(plain.revision, 'n-menu', '<script>document.body.dataset.open = ""</script>'),
    )
    expect(scripted.note).toContain('guide menu')
  })

  it('keeps the declared tool schemas within their budget', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const size = Buffer.byteLength(JSON.stringify(await c.client.listTools()), 'utf8')
    // One tool per operation, about 91,000 bytes (24,000 tokens) when this was set: node.create,
    // the one tool that takes a node tree, about 9,000, with the shared parts of a schema named
    // once (@lacuno/schema).
    expect(size).toBeLessThan(100_000)
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
