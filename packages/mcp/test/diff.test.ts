import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DocumentStore } from '@freeflow/document'
import { fixtureDocument } from '@freeflow/schema'
import { afterEach, describe, expect, it } from 'vitest'
import type { DocumentDiff } from '../src/diff.js'
import { connect, jsonOf, textOf } from './helpers.js'

const dirs: string[] = []
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

const setup = async (siteDir?: string) => {
  const store = DocumentStore.inMemory(fixtureDocument())
  const c = await connect(store, siteDir ? { siteDir } : {})
  close = c.close
  return { client: c.client, store }
}

const batch = [
  { type: 'page.update', id: 'p-home', name: 'Start' },
  {
    type: 'style.set',
    class: 'c-heading',
    breakpoint: 'base',
    state: 'hover',
    property: 'color',
    value: { type: 'designToken', ref: 't-brand' },
  },
  {
    type: 'node.create',
    parent: 'n-hero-inner',
    index: 0,
    node: {
      id: 'n-kicker',
      type: 'text',
      tag: 'p',
      text: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New' }] }],
      },
    },
  },
]

describe('document.diff', () => {
  it('summarises a dry-run batch without committing it', async () => {
    const { client, store } = await setup()
    const out = textOf(
      await client.callTool({ name: 'document.diff', arguments: { operations: batch } }),
    )
    expect(out).toBe(
      [
        'Pages',
        '~ p-home Start name: Home → Start',
        '',
        'Nodes',
        '+ n-kicker p on /',
        '',
        'Styles',
        '+ .c-heading base:hover color: var(--color-brand)',
      ].join('\n'),
    )
    expect(store.revision).toBe(0)
  })

  it('compares against another document file and round-trips as JSON', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-mcp-diff-'))
    dirs.push(dir)
    await writeFile(path.join(dir, 'old.json'), JSON.stringify(fixtureDocument()))
    const { client, store } = await setup(dir)
    const unchanged = await client.callTool({
      name: 'document.diff',
      arguments: { against: 'old.json' },
    })
    expect(textOf(unchanged)).toBe('No changes.')
    await store.apply({
      expectedRevision: 0,
      operations: [
        {
          type: 'designToken.setValue',
          id: 't-brand',
          mode: 'light',
          value: { type: 'color', value: '#e03131' },
        },
      ],
    })
    const diff = jsonOf<DocumentDiff>(
      await client.callTool({
        name: 'document.diff',
        arguments: { against: path.join(dir, 'old.json'), json: true },
      }),
    )
    expect(diff).toEqual({
      designTokens: [
        {
          change: 'changed',
          id: 't-brand',
          label: 'color.brand',
          field: 'values.light',
          before: '#3b5bdb',
          after: '#e03131',
        },
      ],
    })
  })

  it('reports a move as a position change', async () => {
    const { client } = await setup()
    const out = textOf(
      await client.callTool({
        name: 'document.diff',
        arguments: {
          operations: [{ type: 'node.move', id: 'n-hero-cta', parent: 'n-hero-inner', index: 0 }],
        },
      }),
    )
    expect(out).toContain('~ n-hero-cta a on / position: 2 → 0')
    expect(out).not.toContain('n-hero-inner')
  })

  it('needs exactly one of operations or against', async () => {
    const { client } = await setup()
    const result = await client.callTool({ name: 'document.diff', arguments: {} })
    expect(result.isError).toBe(true)
    expect(jsonOf(result)).toMatchObject({ kind: 'input' })
  })
})
