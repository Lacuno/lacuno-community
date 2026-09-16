import { DocumentStore } from '@freeflow/document'
import { fixtureDocument } from '@freeflow/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { connect, jsonOf, textOf } from './helpers.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
})
const setup = async () => {
  const c = await connect(DocumentStore.inMemory(fixtureDocument()))
  close = c.close
  return c.client
}

describe('read tools', () => {
  it('document.read gives an overview without nodes, styles or entries', async () => {
    const client = await setup()
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
      'revision',
      'site',
    ])
  })

  it('page.outline renders an indented tree with classes and text snippets', async () => {
    const client = await setup()
    const out = textOf(
      await client.callTool({ name: 'page.outline', arguments: { page: 'p-home' } }),
    )
    expect(out.split('\n')[0]).toBe('n-home main .page')
    expect(out).toContain('  n-hero section .container.hero')
    expect(out).toContain(
      '      n-hero-title h1 .heading.ff-l-hero-title "Design it. Publish it. Own it."',
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
    const bad = await client.callTool({ name: 'page.outline', arguments: { page: 'nope' } })
    expect(bad.isError).toBe(true)
    expect(jsonOf(bad)).toMatchObject({ kind: 'input' })
  })

  it('node.get returns a nested subtree', async () => {
    const client = await setup()
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
    const client = await setup()
    const styles = jsonOf<Record<string, Record<string, Record<string, Record<string, unknown>>>>>(
      await client.callTool({ name: 'styles.get', arguments: { class: 'c-button' } }),
    )
    expect(Object.keys(styles)).toEqual(['c-button'])
    expect(styles['c-button']!.base!.hover!['background-color']).toEqual({
      type: 'designToken',
      ref: 't-surface-muted',
    })
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
})
