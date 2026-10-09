import { DocumentStore } from '@lacuno/document'
import { fixtureDocument } from '@lacuno/schema'
import { afterEach, describe, expect, it } from 'vitest'
import type { ServerOptions } from '../src/index.js'
import { connect, jsonOf, textOf } from './helpers.js'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
})

type Selection = ReturnType<NonNullable<ServerOptions['editorToken']>['selection']>

/** A server with the embedded editor, whose last report is `selection`. */
async function withSelection(selection: () => Selection) {
  const doc = fixtureDocument()
  doc.nodes['n-hero']!.meta = { label: 'Hero' }
  const c = await connect(DocumentStore.inMemory(doc), {
    editorToken: {
      origin: 'https://runtime.test',
      mint: () => ({ token: 't', site: 's', expiresAt: '' }),
      selection,
    },
  })
  close = c.close
  return c.client
}

describe('editor.selection', () => {
  it('names the page and the element the person selected, labelled as page.view labels', async () => {
    const at = Date.now()
    let selection: Selection = { page: 'p-post', node: 'n-hero', at }
    const client = await withSelection(() => selection)
    const tool = (await client.listTools()).tools.find((t) => t.name === 'editor.selection')
    expect(tool?.annotations?.readOnlyHint).toBe(true)
    const read = async () => client.callTool({ name: 'editor.selection', arguments: {} })
    expect(jsonOf(await read())).toEqual({
      page: { id: 'p-post', name: 'Post', path: '/blog/[slug]' },
      node: { id: 'n-hero', label: 'Hero', tag: 'section' },
      at: new Date(at).toISOString(),
    })
    selection = { page: 'p-home', node: 'n-hero-title', at }
    expect(jsonOf<{ node: unknown }>(await read()).node).toEqual({
      id: 'n-hero-title',
      label: 'h1',
      tag: 'h1',
    })
    selection = { page: 'p-home', at }
    expect(jsonOf<{ node: unknown }>(await read()).node).toBeNull()
  })

  it('says the editor is not open without a report, or with one older than an hour', async () => {
    let selection: Selection
    const client = await withSelection(() => selection)
    const read = async () =>
      textOf(await client.callTool({ name: 'editor.selection', arguments: {} }))
    const closed = 'The editor is not open in this chat, or nothing was selected yet.'
    expect(await read()).toBe(closed)
    selection = { page: 'p-home', at: Date.now() - 61 * 60_000 }
    expect(await read()).toBe(closed)
  })

  it('is not offered without the embedded editor', async () => {
    const c = await connect(DocumentStore.inMemory(fixtureDocument()))
    close = c.close
    const names = (await c.client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain('editor.selection')
  })
})
