import { existsSync } from 'node:fs'
import { lstat, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { styleKey } from '@freeflow/schema'
import { afterEach, describe, expect, it } from 'vitest'
import { writeFixtureSite } from '../src/fixture-site.js'
import { cssImageAssets, ROUTE_SOURCE, writeScaffold } from '../src/scaffold.js'

const dirs: string[] = []
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), 'freeflow-scaffold-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('writeFixtureSite', () => {
  it('writes a document whose hero asset matches the file on disk', async () => {
    const dir = await tmp()
    const doc = await writeFixtureSite(dir)
    const hero = doc.assets['a-hero']!
    expect(hero.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(existsSync(path.join(dir, 'assets', hero.hash))).toBe(true)
    const onDisk = JSON.parse(await readFile(path.join(dir, 'freeflow.json'), 'utf8'))
    expect(onDisk.assets['a-hero'].hash).toBe(hero.hash)
  })
})

describe('writeScaffold', () => {
  it('writes files, copies assets by kind and links packages', async () => {
    const siteDir = await tmp()
    const doc = await writeFixtureSite(siteDir)
    const fake = await tmp()
    const root = path.join(siteDir, '.freeflow', 'astro')
    await writeScaffold({ root, siteDir, doc, css: 'body{}', astroDir: fake, compilerDir: fake })
    const hero = doc.assets['a-hero']!
    expect(await readFile(path.join(root, 'src/pages/[...path].astro'), 'utf8')).toBe(ROUTE_SOURCE)
    expect(await readFile(path.join(root, 'src/styles/site.css'), 'utf8')).toBe('body{}')
    expect(JSON.parse(await readFile(path.join(root, 'src/data/document.json'), 'utf8'))).toEqual(
      doc,
    )
    expect(existsSync(path.join(root, 'src/assets', `${hero.hash}.png`))).toBe(true)
    expect(existsSync(path.join(root, 'public/assets', `${hero.hash}.png`))).toBe(false)
    expect(await readFile(path.join(root, 'public/robots.txt'), 'utf8')).toBe(
      'User-agent: *\nAllow: /\n',
    )
    expect((await lstat(path.join(root, 'node_modules/astro'))).isSymbolicLink()).toBe(true)
    expect(await readlink(path.join(root, 'node_modules/@freeflow/compiler'))).toBe(fake)
  })

  it('clears a previous scaffold and points robots at the sitemap when the url is set', async () => {
    const siteDir = await tmp()
    const doc = await writeFixtureSite(siteDir)
    doc.site.url = 'https://example.com'
    const fake = await tmp()
    const root = path.join(siteDir, '.freeflow', 'astro')
    await writeScaffold({ root, siteDir, doc, css: '', astroDir: fake, compilerDir: fake })
    const stale = path.join(root, 'src/stale.txt')
    await writeFile(stale, 'x')
    await writeScaffold({ root, siteDir, doc, css: '', astroDir: fake, compilerDir: fake })
    expect(existsSync(stale)).toBe(false)
    expect(await readFile(path.join(root, 'public/robots.txt'), 'utf8')).toContain(
      'Sitemap: https://example.com/sitemap-index.xml',
    )
  })

  it('copies css-referenced images and other kinds to public, and fails on a missing file', async () => {
    const siteDir = await tmp()
    const doc = await writeFixtureSite(siteDir)
    const decl = {
      class: 'c-hero',
      breakpoint: 'base',
      state: 'none' as const,
      property: 'background-image',
      value: { type: 'image' as const, asset: 'a-hero' },
    }
    doc.styles[styleKey(decl)] = decl
    expect([...cssImageAssets(doc)]).toEqual(['a-hero'])
    doc.assets['a-pdf'] = {
      id: 'a-pdf',
      name: 'x.pdf',
      kind: 'file',
      hash: 'nothere',
      mime: 'application/pdf',
      size: 1,
    }
    const fake = await tmp()
    const root = path.join(siteDir, '.freeflow', 'astro')
    await expect(
      writeScaffold({ root, siteDir, doc, css: '', astroDir: fake, compilerDir: fake }),
    ).rejects.toMatchObject({ kind: 'render', message: expect.stringContaining('a-pdf') })
    delete doc.assets['a-pdf']
    await writeScaffold({ root, siteDir, doc, css: '', astroDir: fake, compilerDir: fake })
    const hero = doc.assets['a-hero']!
    expect(existsSync(path.join(root, 'public/assets', `${hero.hash}.png`))).toBe(true)
    expect(existsSync(path.join(root, 'src/assets', `${hero.hash}.png`))).toBe(true)
  })
})
