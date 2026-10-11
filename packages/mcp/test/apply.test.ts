import { DocumentStore } from '@lacuno/document'
import { fixtureDocument } from '@lacuno/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { connect, jsonOf, textOf } from './helpers.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
})

describe('document.apply', () => {
  it('applies a batch, reports created ids, and rejects a stale revision', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const res = jsonOf<{
      revision: number
      created: Record<string, string[]>
      patches?: unknown[]
    }>(
      await c.client.callTool({
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
    const stale = await c.client.callTool({
      name: 'document.apply',
      arguments: { expectedRevision: 0, operations: [] },
    })
    expect(stale.isError).toBe(true)
    expect(jsonOf(stale)).toMatchObject({ kind: 'stale', expected: 0, current: 1 })
  })

  it('returns structured operation errors and supports dry runs', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const err = await c.client.callTool({
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
      await c.client.callTool({
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
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const bad = await c.client.callTool({
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

  it('builds a step that rises on custom keyframes, as in an Apple-style story', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const raw = (value: string) => ({ type: 'raw', value })
    const res = jsonOf<{ warnings?: unknown[] }>(
      await c.client.callTool({
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
    const html = textOf(await c.client.callTool({ name: 'page.preview', arguments: { page: '/' } }))
    expect(html).toContain('@keyframes drift {\n  0% { opacity: 0; translate: 0 40px; }\n}')
    expect(html).toMatch(/class="step[^"]*"[^>]*data-lacuno-motion="scroll" data-lc-step="1"/)
  })
})
