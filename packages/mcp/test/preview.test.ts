import { DocumentStore } from '@lacuno/document'
import { fixtureDocument } from '@lacuno/schema'
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

describe('page.preview', () => {
  it('returns the home page as a full HTML document', async () => {
    const client = await setup()
    const html = textOf(await client.callTool({ name: 'page.preview', arguments: { page: '/' } }))
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>Fixture Co</title>')
    expect(html).toContain('Design it. Publish it. Own it.')
    expect(html).toMatch(/<img[^>]+src="\/assets\/[a-f0-9]{64}\.png"/)
    expect(html).toContain('<style>')
    expect(html).not.toContain('data-lacuno-node')
  })

  it('lists text nodes with their ids in text mode', async () => {
    const client = await setup()
    const lines = textOf(
      await client.callTool({ name: 'page.preview', arguments: { page: 'p-home', text: true } }),
    ).split('\n')
    expect(lines[0]).toBe('n-hero-title\tDesign it. Publish it. Own it.')
    expect(lines).toContain('n-hero-cta\tRead the blog')
    // Card titles come from the component prop bound to each entry's title, newest first.
    expect(lines.filter((l) => l.startsWith('n-card-title\t'))).toEqual([
      'n-card-title\tThird post',
      'n-card-title\tSecond post',
      'n-card-title\tHello world',
    ])
  })

  it('renders a collection page for an entry and errors without one', async () => {
    const client = await setup()
    const lines = textOf(
      await client.callTool({
        name: 'page.preview',
        arguments: { page: 'p-post', entry: 'hello-world', text: true },
      }),
    )
    expect(lines).toBe('n-post-title\tHello world\nn-post-body\tThe first post.')
    const missing = await client.callTool({ name: 'page.preview', arguments: { page: 'p-post' } })
    expect(missing.isError).toBe(true)
    const error = jsonOf<{ kind: string; message: string }>(missing)
    expect(error.kind).toBe('input')
    expect(error.message).toContain('/blog/hello-world (p-post entry e-1)')
    expect(error.message).toContain('/ (p-home)')
  })
})
