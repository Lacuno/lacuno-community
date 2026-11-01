import { DocumentStore, OPERATIONS } from '@lacuno/document'
import { fixtureDocument } from '@lacuno/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { applyEach, connect, jsonOf, textOf } from './helpers.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
})

describe('operation tools', () => {
  it('offers every operation as a tool of its name, described and annotated', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const { tools } = await c.client.listTools()
    const byName = new Map(tools.map((tool) => [tool.name, tool]))
    for (const { type } of OPERATIONS) {
      const tool = byName.get(type)
      if (type === 'asset.create') {
        expect(tool).toBeUndefined()
        continue
      }
      expect(tool?.description, type).toBeTruthy()
      expect(tool?.inputSchema.required, type).toContain('expectedRevision')
      expect(tool?.annotations?.readOnlyHint, type).toBe(false)
    }
    expect(byName.get('node.delete')?.annotations).toMatchObject({ destructiveHint: true })
    expect(byName.get('node.create')?.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: false,
    })
    expect(byName.get('style.set')?.annotations).toMatchObject({
      destructiveHint: false,
      idempotentHint: true,
    })
    expect(byName.has('document.apply')).toBe(false)
  })

  it('applies one change, reports created ids, and rejects a stale revision', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const res = jsonOf<{ revision: number; created: Record<string, string[]>; patches?: unknown }>(
      await c.client.callTool({
        name: 'class.create',
        arguments: { expectedRevision: 0, id: 'c-x', name: 'x' },
      }),
    )
    expect(res.revision).toBe(1)
    expect(res.created['0']).toEqual(['c-x'])
    expect(res.patches).toBeUndefined()
    expect(store.read().document.classes['c-x']).toBeDefined()
    const stale = await c.client.callTool({
      name: 'style.set',
      arguments: {
        expectedRevision: 0,
        class: 'c-x',
        property: 'color',
        value: { type: 'color', value: 'red' },
      },
    })
    expect(stale.isError).toBe(true)
    expect(jsonOf(stale)).toMatchObject({ kind: 'stale', expected: 0, current: 1 })
  })

  it('returns structured operation errors and supports dry runs', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const err = await c.client.callTool({
      name: 'class.delete',
      arguments: { expectedRevision: 0, id: 'c-button' },
    })
    expect(jsonOf(err)).toMatchObject({
      kind: 'operation',
      type: 'class.delete',
      referencedBy: ['classes.c-button-primary', 'nodes.n-hero-cta'],
    })
    const dry = jsonOf<{ revision: number; patches: unknown[] }>(
      await c.client.callTool({
        name: 'node.delete',
        arguments: { expectedRevision: 0, dryRun: true, id: 'n-hero' },
      }),
    )
    expect(dry.revision).toBe(0)
    expect(dry.patches).toHaveLength(6)
    expect(store.read().document.nodes['n-hero']).toBeDefined()
  })

  it('refuses input its schema does not allow, naming the field, before anything changes', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const bad = await c.client.callTool({ name: 'node.create', arguments: { expectedRevision: 0 } })
    expect(bad.isError).toBe(true)
    expect(textOf(bad)).toContain('parent')
    expect(store.read().revision).toBe(0)
  })

  it('builds a step that rises on custom keyframes, as in an Apple-style story', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const raw = (value: string) => ({ type: 'raw', value })
    const res = jsonOf<{ warnings?: unknown[] }>(
      await applyEach(c.client, 0, [
        {
          type: 'keyframes.create',
          id: 'drift',
          stops: [{ at: 0, styles: { opacity: raw('0'), translate: raw('0 40px') } }],
        },
        { type: 'style.set', class: 'c-step', property: '--lc-scroll', value: raw('drift') },
      ]),
    )
    expect(res.warnings ?? []).toEqual([])
    const html = textOf(await c.client.callTool({ name: 'page.preview', arguments: { page: '/' } }))
    expect(html).toContain('@keyframes drift {\n  0% { opacity: 0; translate: 0 40px; }\n}')
    expect(html).toMatch(/class="step[^"]*"[^>]*data-lacuno-motion="scroll" data-lc-step="1"/)
  })
})
