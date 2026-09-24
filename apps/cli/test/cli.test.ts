import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeFixtureSite } from '@miralo/compiler/build'
import { afterEach, describe, expect, it } from 'vitest'
import { parseBuildArgs, runBuild } from '../src/build.js'
import { main } from '../src/cli.js'

function io() {
  const out: string[] = []
  const err: string[] = []
  return { out, err, io: { log: (s: string) => out.push(s), error: (s: string) => err.push(s) } }
}

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('parseBuildArgs', () => {
  it('defaults to the current directory and reads flags', () => {
    expect(parseBuildArgs([])).toEqual({ dir: '.', json: false })
    expect(parseBuildArgs(['site', '--out', 'o', '--site-url', 'https://x.y', '--json'])).toEqual({
      dir: 'site',
      out: 'o',
      siteUrl: 'https://x.y',
      json: true,
    })
  })
  it('rejects unknown flags and extra positionals', () => {
    expect(() => parseBuildArgs(['--nope'])).toThrow(/Usage/)
    expect(() => parseBuildArgs(['a', 'b'])).toThrow(/Usage/)
  })
})

describe('main', () => {
  it('prints usage without a command and rejects unknown commands', async () => {
    const a = io()
    expect(await main([], a.io)).toBe(1)
    expect(a.out.join('\n')).toContain('Usage')
    const b = io()
    expect(await main(['--help'], b.io)).toBe(0)
    const c = io()
    expect(await main(['frobnicate'], c.io)).toBe(1)
    expect(c.err.join('\n')).toContain('unknown command frobnicate')
  })

  it('reports a document error for a folder without a document', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'miralo-cli-'))
    dirs.push(dir)
    const a = io()
    expect(await runBuild([dir], a.io)).toBe(1)
    expect(a.err.join('\n')).toContain('no miralo.json')
    const b = io()
    expect(await runBuild([dir, '--json'], b.io)).toBe(1)
    expect(JSON.parse(b.out.join(''))).toMatchObject({ error: { kind: 'document' } })
  })

  it('rejects an --out equal to the site directory', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'miralo-cli-'))
    dirs.push(dir)
    const a = io()
    expect(await runBuild([dir, '--out', dir, '--json'], a.io)).toBe(1)
    expect(JSON.parse(a.out.join(''))).toMatchObject({ error: { kind: 'options' } })
  })
})

describe.skipIf(process.env.MIRALO_FAST_TESTS)('build command (runs Astro, slow)', () => {
  it('builds a site and prints a summary or json', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'miralo-cli-'))
    dirs.push(dir)
    await writeFixtureSite(dir)
    const a = io()
    expect(await main(['build', dir], a.io)).toBe(0)
    expect(a.out.join('\n')).toMatch(/Built 5 pages to .*dist in \d+ ms/)
    expect(existsSync(path.join(dir, 'dist/index.html'))).toBe(true)
    const b = io()
    expect(await main(['build', dir, '--json'], b.io)).toBe(0)
    expect(JSON.parse(b.out.join(''))).toMatchObject({ pages: 5, warnings: [] })
  })
})
