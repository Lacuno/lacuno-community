import { DocumentStore, OPERATIONS } from '@lacuno/document'
import { fixtureDocument } from '@lacuno/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { WITHHELD_OPERATIONS } from '../src/operations.js'
import { applyChanges, connect, jsonOf, textOf } from './helpers.js'

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
      if (type in WITHHELD_OPERATIONS) {
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
    // A tool that replaces what was there destroys it, as OpenAI's tool scan holds; a move loses
    // nothing.
    for (const name of ['style.set', 'node.update', 'designToken.setValue', 'translations.apply'])
      expect(byName.get(name)?.annotations, name).toMatchObject({
        destructiveHint: true,
        idempotentHint: true,
      })
    expect(byName.get('node.move')?.annotations).toMatchObject({ destructiveHint: false })
    expect(byName.has('document.apply')).toBe(false)
    // Lean schemas: no $schema line, safe-integer bounds, id patterns or dryRun.
    const listed = JSON.stringify(tools.filter((tool) => tool.name !== 'translations.apply'))
    for (const noise of [
      '$schema',
      '9007199254740991',
      '{1,64}',
      'dryRun',
      '"additionalProperties":false',
    ])
      expect(listed).not.toContain(noise)
    // One or more changes of the tool's kind, each with the operation's own fields.
    expect(byName.get('node.move')?.inputSchema).toMatchObject({
      required: ['expectedRevision', 'changes'],
      properties: {
        expectedRevision: { type: 'integer', minimum: 0 },
        changes: {
          type: 'array',
          minItems: 1,
          items: { required: ['id', 'parent', 'index'], properties: { id: { type: 'string' } } },
        },
      },
    })
  })

  it('makes a list of changes in one call, says what each created, and refuses a stale revision', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const res = jsonOf<{ revision: number; created: Record<string, string[]>; patches?: unknown }>(
      await c.client.callTool({
        name: 'class.create',
        arguments: {
          expectedRevision: 0,
          changes: [
            { id: 'c-x', name: 'x' },
            { id: 'c-y', name: 'y' },
          ],
        },
      }),
    )
    expect(res.revision).toBe(1)
    expect(res.created).toEqual({ '0': ['c-x'], '1': ['c-y'] })
    expect(res.patches).toBeUndefined()
    expect(Object.keys(store.read().document.classes)).toEqual(
      expect.arrayContaining(['c-x', 'c-y']),
    )
    const stale = await c.client.callTool({
      name: 'style.set',
      arguments: {
        expectedRevision: 0,
        changes: [{ class: 'c-x', property: 'color', value: { type: 'color', value: 'red' } }],
      },
    })
    expect(stale.isError).toBe(true)
    expect(jsonOf(stale)).toMatchObject({ kind: 'stale', expected: 0, current: 1 })
  })

  it('makes a list all or nothing, naming the change it refused', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const err = await c.client.callTool({
      name: 'class.create',
      arguments: {
        expectedRevision: 0,
        changes: [
          { id: 'c-new', name: 'new' },
          { id: 'c-button', name: 'again' },
        ],
      },
    })
    expect(jsonOf(err)).toMatchObject({ kind: 'operation', index: 1, type: 'class.create' })
    expect(store.read().document.classes['c-new']).toBeUndefined()
    expect(store.read().revision).toBe(0)
    const used = await c.client.callTool({
      name: 'class.delete',
      arguments: { expectedRevision: 0, changes: [{ id: 'c-button' }] },
    })
    expect(jsonOf(used)).toMatchObject({
      kind: 'operation',
      index: 0,
      type: 'class.delete',
      referencedBy: ['classes.c-button-primary', 'nodes.n-hero-cta'],
    })
  })

  it('refuses input its schema does not allow, naming the field, before anything changes', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    for (const changes of [[{}], []]) {
      const bad = await c.client.callTool({
        name: 'node.create',
        arguments: { expectedRevision: 0, changes },
      })
      expect(bad.isError).toBe(true)
      expect(textOf(bad)).toContain('changes')
    }
    expect(store.read().revision).toBe(0)
  })

  it("clears a value with null, and reads '' as not given", async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const words = await applyChanges(c.client, 0, [
      { type: 'node.update', id: 'n-hero-title', rotatingWords: { words: ['you'] } },
    ])
    expect(words.isError, textOf(words)).toBeFalsy()
    expect(store.read().document.nodes['n-hero-title']).toHaveProperty('rotatingWords')
    // label applies to language switchers only: '' is no label, so this is no error.
    const cleared = await c.client.callTool({
      name: 'node.update',
      arguments: {
        expectedRevision: 1,
        changes: [{ id: 'n-hero-title', rotatingWords: null, label: '' }],
      },
    })
    expect(cleared.isError, textOf(cleared)).toBeFalsy()
    expect(store.read().document.nodes['n-hero-title']).not.toHaveProperty('rotatingWords')
  })

  it('makes a page and a component with only their root element, which node.create fills', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    const { tools } = await c.client.listTools()
    const changes = tools.find((tool) => tool.name === 'page.create')?.inputSchema.properties
      ?.changes as { items: { properties: { root: object } } }
    expect(JSON.stringify(changes.items.properties.root)).not.toContain('"children"')
    const res = await applyChanges(c.client, 0, [
      { type: 'page.create', id: 'p-team', name: 'Team', path: '/team', root: { id: 'n-team' } },
      {
        type: 'node.create',
        parent: 'n-team',
        node: { type: 'element', tag: 'section', id: 'n-team-intro' },
      },
      {
        type: 'component.create',
        id: 'cmp-tile',
        name: 'Tile',
        root: { id: 'n-tile', tag: 'article' },
      },
      { type: 'component.create', id: 'cmp-plain', name: 'Plain' },
    ])
    expect(res.isError, textOf(res)).toBeFalsy()
    const { document } = store.read()
    expect(document.pages['p-team']?.root).toBe('n-team')
    expect(document.nodes['n-team']).toMatchObject({
      type: 'element',
      tag: 'main',
      children: ['n-team-intro'],
    })
    expect(document.nodes['n-tile']).toMatchObject({ tag: 'article' })
    expect(document.nodes[document.components['cmp-plain']!.root]).toMatchObject({ tag: 'div' })
  })

  it('builds a step that rises on custom keyframes, as in an Apple-style story', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const c = await connect(store)
    close = c.close
    // Keyframes take their styles as CSS text, and keep them as the editor's dialog does.
    const res = jsonOf<{ warnings?: unknown[] }>(
      await applyChanges(c.client, 0, [
        {
          type: 'keyframes.create',
          id: 'drift',
          stops: [{ at: 0, styles: { opacity: '0', translate: '0 40px' } }],
        },
        {
          type: 'style.set',
          class: 'c-step',
          property: '--lc-scroll',
          value: { type: 'raw', value: 'drift' },
        },
      ]),
    )
    expect(res.warnings ?? []).toEqual([])
    expect(store.read().document.keyframes.drift?.stops[0]?.styles).toEqual({
      opacity: { type: 'raw', value: '0' },
      translate: { type: 'raw', value: '0 40px' },
    })
    const html = textOf(await c.client.callTool({ name: 'page.preview', arguments: { page: '/' } }))
    expect(html).toContain('@keyframes drift {\n  0% { opacity: 0; translate: 0 40px; }\n}')
    expect(html).toMatch(/class="step[^"]*"[^>]*data-lacuno-motion="scroll" data-lc-step="1"/)
    const { tools } = await c.client.listTools()
    const keyframes = JSON.stringify(tools.find((tool) => tool.name === 'keyframes.create'))
    expect(keyframes).not.toContain('CssValue')
  })
})
