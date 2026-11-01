import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build, fixtureAssetBytes, writeFixtureSite } from '@lacuno/compiler/build'
import { createFolder } from '@lacuno/document/folder'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureOperations } from '../../document/test/fixture-operations.js'
import { applyChanges, connect, jsonOf, textOf } from './helpers.js'

const dirs: string[] = []
let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

type Change = { type: string } & Record<string, unknown>
type Tree = { id: string; tag: string; classes?: string[]; children?: object[] }

/**
 * The operations as an AI app sends them: page.create and component.create with their root element
 * only, then the root's other fields with node.update and each child with node.create.
 */
function shallow(operations: Change[]): Change[] {
  return operations.flatMap((op) => {
    if (op.type !== 'page.create' && op.type !== 'component.create') return [op]
    const {
      type: _,
      id,
      tag,
      classes,
      children = [],
      ...rest
    } = op.root as Tree & {
      type: string
    }
    return [
      { ...op, root: { id, tag, classes } },
      ...(Object.keys(rest).length ? [{ type: 'node.update', id, ...rest }] : []),
      ...children.map((node, index) => ({ type: 'node.create', parent: id, index, node })),
    ]
  })
}

describe('building the fixture site through MCP', () => {
  it('matches the compiler building the fixture directly', async () => {
    const a = await mkdtemp(path.join(os.tmpdir(), 'lacuno-mcp-a-'))
    dirs.push(a)
    const b = await mkdtemp(path.join(os.tmpdir(), 'lacuno-mcp-b-'))
    dirs.push(b)
    const store = await createFolder(a, 'Fixture Co')
    const c = await connect(store, { siteDir: a })
    close = c.close
    const initialPage = Object.keys(store.read().document.pages)[0] as string
    const bytes = await fixtureAssetBytes()
    const asset = jsonOf<{ id: string; hash: string }>(
      await c.client.callTool({
        name: 'asset.import',
        arguments: {
          name: 'hero.png',
          mime: 'image/png',
          data: bytes['a-hero'].toString('base64'),
          alt: 'Hero image',
          width: 1200,
          height: 800,
        },
      }),
    )
    const clip = jsonOf<{ id: string }>(
      await c.client.callTool({
        name: 'asset.import',
        arguments: {
          name: 'clip.mp4',
          mime: 'video/mp4',
          data: bytes['a-clip'].toString('base64'),
        },
      }),
    )
    const font = async (name: string, data: Buffer) =>
      jsonOf<{ id: string }>(
        await c.client.callTool({
          name: 'asset.import',
          arguments: {
            name,
            mime: 'font/woff2',
            data: data.toString('base64'),
          },
        }),
      )
    const sans = await font('FixtureSans-Regular.woff2', bytes['a-sans'])
    const sansBold = await font('FixtureSans-Bold.woff2', bytes['a-sans-bold'])
    // The fixture registers its assets itself; replace those operations with the imported asset ids.
    const ops = shallow(fixtureOperations(initialPage))
      .filter((o) => o.type !== 'asset.create')
      .map((o) =>
        JSON.parse(
          JSON.stringify(o)
            .replaceAll('"a-hero"', `"${asset.id}"`)
            .replaceAll('"a-clip"', `"${clip.id}"`)
            .replaceAll('"a-sans"', `"${sans.id}"`)
            .replaceAll('"a-sans-bold"', `"${sansBold.id}"`),
        ),
      )
    // As an AI app sends them: consecutive changes of one kind in one call, a revision each.
    const before = store.revision
    const calls = ops.filter((op, index) => op.type !== ops[index - 1]?.type).length
    const applied = jsonOf<{ revision: number }>(await applyChanges(c.client, before, ops))
    expect(applied.revision).toBe(before + calls)
    const preview = textOf(
      await c.client.callTool({ name: 'page.preview', arguments: { page: '/' } }),
    )
    expect(preview).toContain('Design it. Publish it. Own it.')
    const built = jsonOf<{ pages: number; outDir: string }>(
      await c.client.callTool({
        name: 'site.build',
        arguments: { siteUrl: 'https://example.com' },
      }),
    )
    expect(built.pages).toBe(5)

    await writeFixtureSite(b)
    const direct = await build(b, { quiet: true, siteUrl: 'https://example.com' })
    for (const page of ['index.html', 'blog/hello-world/index.html']) {
      const viaMcp = await readFile(path.join(built.outDir, page), 'utf8')
      const viaCompiler = await readFile(path.join(direct.outDir, page), 'utf8')
      expect(viaMcp.replace(/[a-f0-9]{64}/g, 'HASH')).toBe(
        viaCompiler.replace(/[a-f0-9]{64}/g, 'HASH'),
      )
    }
  })
})
