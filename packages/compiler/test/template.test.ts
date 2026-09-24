import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from '@miralo/schema'
import { expect, it } from 'vitest'
import { build } from '../src/build.js'
import { enumerateRoutes } from '../src/routes.js'

it.skipIf(Boolean(process.env.MIRALO_FAST_TESTS))(
  'builds the copied default template',
  async () => {
    const source = fileURLToPath(new URL('../../../templates/miralo/', import.meta.url))
    const dir = await mkdtemp(path.join(os.tmpdir(), 'miralo-template-'))
    try {
      await cp(path.join(source, 'miralo.json'), path.join(dir, 'miralo.json'))
      await cp(path.join(source, 'assets'), path.join(dir, 'assets'), { recursive: true })
      const doc = parseDocument(JSON.parse(await readFile(path.join(dir, 'miralo.json'), 'utf8')))
      const routes = enumerateRoutes(doc).map((route) => route.path)
      expect(routes).toEqual([
        '/',
        '/about',
        '/blog',
        '/blog/from-document-to-website',
        '/blog/hosted-or-self-hosted',
        '/blog/your-website-your-rules',
      ])
      const result = await build(dir, { quiet: true })
      expect(result.pages).toBe(6)
      expect(result.warnings).toEqual([])
      for (const route of routes) {
        const html = await readFile(path.join(result.outDir, route.slice(1), 'index.html'), 'utf8')
        expect(html).toContain('<main')
        expect(html).toContain('<h1')
        expect(html).not.toContain('[object Object]')
      }
      const blog = await readFile(path.join(result.outDir, 'blog/index.html'), 'utf8')
      for (const route of routes.filter((route) => route.startsWith('/blog/'))) {
        expect(blog).toContain(`href="${route}"`)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
)
