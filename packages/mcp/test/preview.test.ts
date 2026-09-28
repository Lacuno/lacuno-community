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

  it('publishes a gradient headline and rotating words set through document.apply', async () => {
    const client = await setup()
    const guide = textOf(await client.callTool({ name: 'guide', arguments: {} }))
    expect(guide).toContain('## Gradients')
    expect(guide).toContain('rotatingWords')
    expect(guide).toContain('pen-tool')
    const applied = await client.callTool({
      name: 'document.apply',
      arguments: {
        expectedRevision: 0,
        operations: [
          {
            type: 'style.set',
            class: 'l-hero-title',
            breakpoint: 'base',
            state: 'none',
            property: 'background-image',
            value: {
              type: 'gradient',
              kind: 'linear',
              angle: 90,
              stops: [
                { color: { type: 'designToken', ref: 't-brand' }, position: 0 },
                { color: { type: 'color', value: '#e0529c' }, position: 100 },
              ],
            },
          },
          ...(['background-clip', 'color'] as const).map((property) => ({
            type: 'style.set',
            class: 'l-hero-title',
            breakpoint: 'base',
            state: 'none',
            property,
            value: { type: 'keyword', value: property === 'color' ? 'transparent' : 'text' },
          })),
          {
            type: 'node.update',
            id: 'n-hero-title',
            text: { type: 'static', value: 'AI' },
            rotatingWords: {
              icon: 'sparkles',
              words: [{ text: 'designer', icon: 'pen-tool' }, 'you'],
            },
          },
        ],
      },
    })
    expect(applied.isError).toBeFalsy()
    const html = textOf(await client.callTool({ name: 'page.preview', arguments: { page: '/' } }))
    expect(html).toContain(
      'background-image: linear-gradient(90deg, var(--color-brand) 0%, #e0529c 100%);',
    )
    expect(html).toContain('background-clip: text;')
    expect(html).toMatch(
      /<span aria-hidden="true" data-lc-words="3"><span><svg [^>]+>.+?<\/svg>AI<\/span>/,
    )
    expect(html.match(/<svg /g)).toHaveLength(2)
    expect(html).toContain('<span data-lc-said>AI, designer, you</span>')
    const bad = await client.callTool({
      name: 'document.apply',
      arguments: {
        expectedRevision: 1,
        operations: [{ type: 'node.update', id: 'n-hero', rotatingWords: { words: ['x'] } }],
      },
    })
    expect(bad.isError).toBe(true)
  })

  it("publishes the guide's table example and refuses a malformed table", async () => {
    const client = await setup()
    const guide = textOf(await client.callTool({ name: 'guide', arguments: {} }))
    const table = JSON.parse(guide.match(/```json\n(\{ "type": "table"[\s\S]+?)\n```/)![1]!)
    const apply = (expectedRevision: number, content: object[]) =>
      client.callTool({
        name: 'document.apply',
        arguments: {
          expectedRevision,
          operations: [
            { type: 'node.update', id: 'n-hero-title', tag: 'div', text: { type: 'doc', content } },
          ],
        },
      })
    expect((await apply(0, [table])).isError).toBeFalsy()
    const node = jsonOf<{ text: object }>(
      await client.callTool({ name: 'node.get', arguments: { id: 'n-hero-title' } }),
    )
    expect(JSON.stringify(node)).toContain('"tableHeader"')
    const html = textOf(await client.callTool({ name: 'page.preview', arguments: { page: '/' } }))
    expect(html).toContain(
      '<div class="lc-table" role="region" aria-label="Table" tabindex="0"><table><thead><tr><th scope="col">What</th>',
    )
    expect(html).toContain('<td><strong>To sign in</strong></td>')
    expect(html).toContain(':where(.lc-table) { overflow-x: auto;')
    // A row short of a cell is refused, with the reason.
    const ragged = structuredClone(table)
    ragged.content[1].content.pop()
    const bad = await apply(1, [ragged])
    expect(bad.isError).toBe(true)
    expect(textOf(bad)).toContain('every row of a table needs the same number of columns')
    // Rich-text fields take tables too, under the same rules.
    const entry = (fields: object) =>
      client.callTool({
        name: 'document.apply',
        arguments: {
          expectedRevision: 1,
          operations: [{ type: 'entry.update', collection: 'col-posts', id: 'e-1', fields }],
        },
      })
    const nested = structuredClone(table)
    nested.content[1].content[0].content = [table]
    expect(textOf(await entry({ 'f-body': { type: 'doc', content: [nested] } }))).toContain(
      'field body: a table cannot sit inside a table',
    )
    expect((await entry({ 'f-body': { type: 'doc', content: [table] } })).isError).toBeFalsy()
  })

  it('publishes a radial glow from the top and refuses a centre on a linear gradient', async () => {
    const client = await setup()
    const guide = textOf(await client.callTool({ name: 'guide', arguments: {} }))
    expect(guide).toContain('"kind":"radial","at":{"x":50,"y":0}')
    const stops = [
      { color: { type: 'color', value: '#ece4ff' }, position: 0 },
      { color: { type: 'color', value: '#ffffff' }, position: 75 },
    ]
    const apply = (expectedRevision: number, value: object) =>
      client.callTool({
        name: 'document.apply',
        arguments: {
          expectedRevision,
          operations: [
            {
              type: 'style.set',
              class: 'l-hero-title',
              breakpoint: 'base',
              state: 'none',
              property: 'background-image',
              value: { type: 'gradient', stops, ...value },
            },
          ],
        },
      })
    expect((await apply(0, { kind: 'radial', at: { x: 50, y: 0 } })).isError).toBeFalsy()
    const html = textOf(await client.callTool({ name: 'page.preview', arguments: { page: '/' } }))
    expect(html).toContain('background-image: radial-gradient(at 50% 0%, #ece4ff 0%, #ffffff 75%);')
    expect((await apply(1, { kind: 'linear', at: { x: 50, y: 0 } })).isError).toBe(true)
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
