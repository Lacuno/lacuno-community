import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { build } from '../src/build.js'
import { writeFixtureSite } from '../src/fixture-site.js'

const dirs: string[] = []
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), 'lacuno-build-'))
  dirs.push(d)
  return d
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe.skipIf(process.env.LACUNO_FAST_TESTS)('build (runs Astro, slow)', () => {
  it('builds the fixture site to static output and is idempotent', async () => {
    const dir = await tmp()
    await writeFixtureSite(dir)
    const cwdBefore = process.cwd()
    const result = await build(dir, { siteUrl: 'https://example.com', quiet: true })
    expect(process.cwd()).toBe(cwdBefore)
    expect(result.pages).toBe(5)
    expect(result.warnings).toEqual([])
    expect(result.outDir).toBe(path.join(dir, 'dist'))

    const home = await readFile(path.join(dir, 'dist/index.html'), 'utf8')
    expect(home).toContain('<picture>')
    expect(home).toContain('type="image/avif"')
    expect(home).toMatch(/\.webp \d+w/)
    // Astro inlines the stylesheet when it is small and links it otherwise. Either is fine.
    const inlined = home.includes('--color-brand:#3b5bdb')
    const linked = /<link rel="stylesheet" href="\/_astro\/[^"]+\.css">/.test(home)
    expect(inlined || linked).toBe(true)
    expect(home).toContain('<link rel="canonical" href="https://example.com/">')
    expect(existsSync(path.join(dir, 'dist/blog/hello-world/index.html'))).toBe(true)
    expect(existsSync(path.join(dir, 'dist/blog/third-post/index.html'))).toBe(true)
    expect(existsSync(path.join(dir, 'dist/old-blog/index.html'))).toBe(true)
    expect(existsSync(path.join(dir, 'dist/sitemap-index.xml'))).toBe(true)
    expect(await readFile(path.join(dir, 'dist/404.html'), 'utf8')).toContain('Page not found')
    expect(existsSync(path.join(dir, 'dist/404/index.html'))).toBe(false)
    // The noindex post page and the not-found page stay out of the sitemap.
    const sitemap = await readFile(path.join(dir, 'dist/sitemap-0.xml'), 'utf8')
    expect(sitemap).toContain('<loc>https://example.com/</loc>')
    expect(sitemap).not.toContain('/blog/')
    expect(sitemap).not.toContain('/404')
    expect(await readFile(path.join(dir, 'dist/robots.txt'), 'utf8')).toContain(
      'Sitemap: https://example.com/sitemap-index.xml',
    )

    const again = await build(dir, { siteUrl: 'https://example.com', quiet: true })
    expect(again.pages).toBe(5)
    expect(await readFile(path.join(dir, 'dist/index.html'), 'utf8')).toBe(home)

    // The document's own public URL wins over the option, which is only a fallback.
    const doc = JSON.parse(await readFile(path.join(dir, 'lacuno.json'), 'utf8'))
    doc.site.url = 'https://own.example'
    await writeFile(path.join(dir, 'lacuno.json'), JSON.stringify(doc))
    await build(dir, { siteUrl: 'https://example.com', quiet: true })
    expect(await readFile(path.join(dir, 'dist/index.html'), 'utf8')).toContain(
      '<link rel="canonical" href="https://own.example/">',
    )
    expect(await readFile(path.join(dir, 'dist/robots.txt'), 'utf8')).toContain(
      'Sitemap: https://own.example/sitemap-index.xml',
    )
  })

  it('classifies document and render errors before running Astro', async () => {
    const dir = await tmp()
    await expect(build(dir, { quiet: true })).rejects.toMatchObject({ kind: 'document' })
    await writeFile(path.join(dir, 'lacuno.json'), '{')
    await expect(build(dir, { quiet: true })).rejects.toMatchObject({
      kind: 'document',
      message: expect.stringContaining('not valid JSON'),
    })
    const doc = await writeFixtureSite(dir)
    await unlink(path.join(dir, 'assets', doc.assets['a-hero']!.hash))
    await expect(build(dir, { quiet: true })).rejects.toMatchObject({
      kind: 'render',
      message: expect.stringContaining('a-hero'),
    })
    expect(existsSync(path.join(dir, 'dist'))).toBe(false)
  })
})

describe('build option validation', () => {
  it('rejects symlinked output parents without deleting external contents', async () => {
    const dir = await tmp()
    const outside = await tmp()
    await mkdir(path.join(outside, 'output'))
    await writeFile(path.join(outside, 'output', 'keep.txt'), 'keep')
    await symlink(outside, path.join(dir, 'linked'))
    await expect(build(dir, { outDir: path.join(dir, 'linked', 'output') })).rejects.toMatchObject({
      kind: 'options',
    })
    expect(await readFile(path.join(outside, 'output', 'keep.txt'), 'utf8')).toBe('keep')
    expect(existsSync(path.join(dir, '.lacuno'))).toBe(false)
  })

  it('does not allow build output to replace Git metadata', async () => {
    const dir = await tmp()
    await mkdir(path.join(dir, '.git'))
    await writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main')
    await expect(build(dir, { outDir: path.join(dir, '.git') })).rejects.toMatchObject({
      kind: 'options',
    })
    expect(await readFile(path.join(dir, '.git', 'HEAD'), 'utf8')).toBe('ref: refs/heads/main')
  })
  it('rejects an outDir outside the site directory', async () => {
    const dir = await tmp()
    await expect(build(dir, { outDir: '/somewhere/else' })).rejects.toMatchObject({
      kind: 'options',
    })
  })

  it('rejects an outDir equal to the site directory without touching it', async () => {
    const dir = await tmp()
    await writeFixtureSite(dir)
    await expect(build(dir, { outDir: dir })).rejects.toMatchObject({ kind: 'options' })
    expect(existsSync(path.join(dir, 'lacuno.json'))).toBe(true)
  })

  it('rejects an outDir that is a reserved subdirectory without touching it', async () => {
    const dir = await tmp()
    await writeFixtureSite(dir)
    await expect(build(dir, { outDir: path.join(dir, 'assets') })).rejects.toMatchObject({
      kind: 'options',
    })
    expect(existsSync(path.join(dir, 'lacuno.json'))).toBe(true)
  })
})
