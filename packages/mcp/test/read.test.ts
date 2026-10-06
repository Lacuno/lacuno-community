import { DocumentStore, type Operation } from '@lacuno/document'
import { fixtureDocument } from '@lacuno/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { connect, jsonOf, textOf } from './helpers.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
})
const setup = async () => {
  const store = DocumentStore.inMemory(fixtureDocument())
  const c = await connect(store)
  close = c.close
  return { client: c.client, store }
}

describe('read tools', () => {
  it('document.read gives an overview without nodes, styles or entries', async () => {
    const { client } = await setup()
    const doc = jsonOf<Record<string, unknown>>(
      await client.callTool({ name: 'document.read', arguments: {} }),
    )
    expect(doc.revision).toBe(0)
    expect(Object.keys(doc).sort()).toEqual([
      'assets',
      'breakpoints',
      'classes',
      'collections',
      'components',
      'designTokens',
      'folders',
      'pages',
      'redirects',
      'revision',
      'site',
    ])
  })

  it('document.read lists where each asset is used, so an unused one can be deleted', async () => {
    const { client, store } = await setup()
    await store.apply({
      expectedRevision: store.revision,
      operations: [
        {
          type: 'asset.create',
          id: 'a-spare',
          name: 'spare.png',
          kind: 'image',
          hash: 'c'.repeat(64),
          mime: 'image/png',
          size: 1,
        },
      ],
    })
    const read = async () =>
      jsonOf<{ revision: number; assets: Record<string, { usedBy: string[] }> }>(
        await client.callTool({ name: 'document.read', arguments: {} }),
      )
    const { revision, assets } = await read()
    expect(assets['a-hero']!.usedBy).toEqual(['nodes.n-hero-image'])
    expect(assets['a-sans']!.usedBy).toEqual(['site.fonts.1'])
    expect(assets['a-spare']!.usedBy).toEqual([])
    const apply = (id: string) =>
      client.callTool({
        name: 'document.apply',
        arguments: { expectedRevision: revision, operations: [{ type: 'asset.delete', id }] },
      })
    expect((await apply('a-hero')).isError).toBe(true)
    expect((await apply('a-spare')).isError).toBeFalsy()
    expect(Object.keys((await read()).assets)).not.toContain('a-spare')
  })

  it("reads optional fields a model fills with '' or null as not given", async () => {
    const { client } = await setup()
    const outline = await client.callTool({
      name: 'page.outline',
      arguments: { page: 'p-home', component: '', depth: null },
    })
    expect(outline.isError).toBeFalsy()
    expect(textOf(outline).split('\n')[0]).toBe('n-home main .c-page')
    const guide = await client.callTool({ name: 'guide', arguments: { group: '' } })
    expect(guide.isError).toBeFalsy()
    // The schemas the model sees keep their types.
    const { tools } = await client.listTools()
    expect(
      tools.find((tool) => tool.name === 'page.outline')?.inputSchema.properties,
    ).toMatchObject({
      component: { type: 'string' },
    })
  })

  it('page.outline renders an indented tree with classes and text snippets', async () => {
    const { client } = await setup()
    const out = textOf(
      await client.callTool({ name: 'page.outline', arguments: { page: 'p-home' } }),
    )
    expect(out.split('\n')[0]).toBe('n-home main .c-page')
    expect(out).toContain('  n-hero section .c-container.c-hero')
    expect(out).toContain(
      '      n-hero-title h1 .c-heading.l-hero-title "Design it. Publish it. Own it."',
    )
    expect(out).toContain('    n-post-card [component cmp-card]')
    const shallow = textOf(
      await client.callTool({ name: 'page.outline', arguments: { page: 'p-home', depth: 1 } }),
    )
    expect(shallow.split('\n')).toHaveLength(3)
    const comp = textOf(
      await client.callTool({ name: 'page.outline', arguments: { component: 'cmp-card' } }),
    )
    expect(comp).toContain('n-card-slot [slot body]')
    // A path works as page.preview takes it.
    expect(textOf(await client.callTool({ name: 'page.outline', arguments: { page: '/' } }))).toBe(
      out,
    )
    const bad = await client.callTool({ name: 'page.outline', arguments: { page: 'nope' } })
    expect(bad.isError).toBe(true)
    expect(jsonOf(bad)).toMatchObject({ kind: 'input' })
  })

  it('node.get returns a nested subtree', async () => {
    const { client } = await setup()
    const tree = jsonOf<{ id: string; children: { id: string; children: unknown[] }[] }>(
      await client.callTool({ name: 'node.get', arguments: { id: 'n-hero' } }),
    )
    expect(tree.id).toBe('n-hero')
    expect(tree.children[0]!.id).toBe('n-hero-inner')
    expect(tree.children[0]!.children).toHaveLength(3)
    expect((await client.callTool({ name: 'node.get', arguments: { id: 'nope' } })).isError).toBe(
      true,
    )
  })

  it('styles.get groups declarations and entries.list lists entries', async () => {
    const { client, store } = await setup()
    const styles = jsonOf<Record<string, Record<string, Record<string, Record<string, unknown>>>>>(
      await client.callTool({ name: 'styles.get', arguments: { class: 'c-button' } }),
    )
    expect(Object.keys(styles)).toEqual(['c-button'])
    expect(styles['c-button']!.base!.hover!['background-color']).toEqual({
      type: 'designToken',
      ref: 't-surface-muted',
    })
    await store.apply({
      expectedRevision: store.read().revision,
      operations: [
        // A plain style needs neither breakpoint nor state.
        {
          type: 'style.set',
          class: 'c-button',
          property: 'color',
          value: { type: 'color', value: 'red' },
          important: true,
        } as Operation,
        {
          type: 'style.set',
          class: 'c-button',
          tag: 'strong',
          breakpoint: 'base',
          state: 'none',
          property: 'font-weight',
          value: { type: 'keyword', value: '800' },
        },
      ],
    })
    const withImportant = jsonOf<
      Record<string, Record<string, Record<string, Record<string, unknown>>>>
    >(await client.callTool({ name: 'styles.get', arguments: { class: 'c-button' } }))
    expect(withImportant['c-button']!.base!.none!.color).toEqual({
      value: { type: 'color', value: 'red' },
      important: true,
    })
    expect(withImportant['c-button strong']!.base!.none!['font-weight']).toEqual({
      type: 'keyword',
      value: '800',
    })
    // Several classes, or every class in a node's subtree, in one call.
    const two = jsonOf<Record<string, unknown>>(
      await client.callTool({
        name: 'styles.get',
        arguments: { class: ['c-button', 'c-heading'] },
      }),
    )
    expect(Object.keys(two).sort()).toEqual(['c-button', 'c-button strong', 'c-heading'])
    const hero = jsonOf<Record<string, unknown>>(
      await client.callTool({ name: 'styles.get', arguments: { node: 'n-hero' } }),
    )
    expect(Object.keys(hero)).toEqual(
      expect.arrayContaining(['c-container', 'c-hero', 'c-heading']),
    )
    expect(
      (await client.callTool({ name: 'styles.get', arguments: { node: 'nope' } })).isError,
    ).toBe(true)
    const all = jsonOf<Record<string, unknown>>(
      await client.callTool({ name: 'styles.get', arguments: {} }),
    )
    expect(Object.keys(all).length).toBeGreaterThan(5)
    const entries = jsonOf<{ id: string }[]>(
      await client.callTool({
        name: 'entries.list',
        arguments: { collection: 'col-posts', limit: 2 },
      }),
    )
    expect(entries.map((e) => e.id)).toEqual(['e-1', 'e-2'])
    expect(
      (await client.callTool({ name: 'entries.list', arguments: { collection: 'nope' } })).isError,
    ).toBe(true)
  })

  it('binds a chosen entry on a normal page and lists where entries and collections are used', async () => {
    const { client } = await setup()
    const read = async () =>
      jsonOf<{ revision: number; collections: Record<string, { usedBy: string[] }> }>(
        await client.callTool({ name: 'document.read', arguments: {} }),
      )
    expect((await read()).collections['col-posts']!.usedBy).toEqual([
      'nodes.n-posts',
      'pages.p-post',
    ])
    const applied = await client.callTool({
      name: 'document.apply',
      arguments: {
        expectedRevision: (await read()).revision,
        operations: [
          {
            type: 'node.create',
            parent: 'n-home',
            node: {
              type: 'text',
              id: 'n-legal',
              tag: 'div',
              text: { type: 'field', entry: 'e-1', field: 'f-body' },
            },
          },
        ],
      },
    })
    expect(applied.isError).toBeFalsy()
    expect((await read()).collections['col-posts']!.usedBy).toContain('nodes.n-legal')
    const entries = jsonOf<{ id: string; usedBy: string[] }[]>(
      await client.callTool({ name: 'entries.list', arguments: { collection: 'col-posts' } }),
    )
    expect(entries.map((e) => e.usedBy)).toEqual([['nodes.n-legal'], [], []])
    const preview = textOf(
      await client.callTool({ name: 'page.preview', arguments: { page: '/', text: true } }),
    )
    expect(preview).toContain('n-legal\tThe first post.')
    const refused = await client.callTool({
      name: 'document.apply',
      arguments: {
        expectedRevision: (await read()).revision,
        operations: [{ type: 'entry.delete', collection: 'col-posts', id: 'e-1' }],
      },
    })
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toContain('nodes.n-legal')
  })
})
