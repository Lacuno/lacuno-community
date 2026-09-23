import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { Hono } from 'hono'
import { getMimeType } from 'hono/utils/mime'
import type { PublicationReader } from './publication-reader.js'

/** This app runs on the publishing listener only: no editor, auth, or draft API routes. */
export function publishedApp(reader: PublicationReader) {
  const app = new Hono()
  app.on(['GET', 'HEAD'], '*', async (c) => {
    const url = new URL(c.req.url)
    const host = reader.siteForHost(url.hostname)
    if (!host) return c.notFound()
    const site = host.siteId
    // Testing must never be indexed, including its 404s.
    if (host.target === 'testing') c.header('X-Robots-Tag', 'noindex, nofollow')
    const current = reader.current(site, host.target)
    if (!current) return c.notFound()
    let name: string
    try {
      name = decodeURIComponent(url.pathname)
    } catch {
      return c.notFound()
    }
    if (
      name.includes('\\') ||
      name.includes('\0') ||
      name.split('/').some((part) => part === '..' || part.startsWith('.'))
    )
      return c.notFound()
    const immutable = /^\/(?:assets|_astro)\//.test(name)
    // Old HTML can finish loading its content-addressed assets after an atomic release switch.
    const candidates = [
      current,
      ...(immutable ? reader.readyIds(site).filter((id) => id !== current) : []),
    ]
    for (const id of candidates) {
      const root = path.join(reader.directory(site, id), 'dist')
      let file = path.join(root, name)
      try {
        if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html')
        const actual = await realpath(file)
        const actualRoot = await realpath(root)
        if (!actual.startsWith(actualRoot + path.sep) || !(await stat(actual)).isFile())
          return c.notFound()
        const bytes = await readFile(actual)
        c.header('Content-Type', getMimeType(actual) ?? 'application/octet-stream')
        c.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
        c.header('X-Content-Type-Options', 'nosniff')
        c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
        c.header('Origin-Agent-Cluster', '?1')
        c.header('X-Freeflow-Release', id)
        return c.req.method === 'HEAD' ? c.body(null) : c.body(new Uint8Array(bytes))
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''))
          throw error
      }
    }
    const page = await readFile(
      path.join(reader.directory(site, current), 'dist', '404.html'),
    ).catch(() => undefined)
    if (!page) return c.notFound()
    c.header('Content-Type', 'text/html; charset=utf-8')
    return c.req.method === 'HEAD' ? c.body(null, 404) : c.body(new Uint8Array(page), 404)
  })
  return app
}
