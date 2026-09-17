import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { enumerateRoutes } from '@freeflow/compiler'
import { build, writeFixtureSite } from '@freeflow/compiler/build'
import { launch } from 'chrome-launcher'
import lighthouse from 'lighthouse'
import { chromium } from 'playwright'
import { type Document, parseDocument } from '../packages/schema/src/index.js'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

/** A static file server that maps `/a/b` to `dist/a/b/index.html`, like a CDN would. */
async function serve(dir: string): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    let file = path.join(dir, decodeURIComponent(url.pathname))
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html')
    } catch {
      /* fall through to the read below, which reports 404 */
    }
    try {
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
        'cache-control': file.includes('/_astro/')
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=60',
      })
      res.end(body)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

async function main(): Promise<number> {
  if (process.argv.length > 3) {
    console.error('Usage: pnpm lighthouse [site-folder]')
    return 1
  }
  const source = process.argv[2] ? path.resolve(process.argv[2]) : undefined
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-lighthouse-'))
  try {
    let doc: Document
    if (source) {
      await cp(path.join(source, 'freeflow.json'), path.join(dir, 'freeflow.json'))
      try {
        await cp(path.join(source, 'assets'), path.join(dir, 'assets'), { recursive: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      doc = parseDocument(JSON.parse(await readFile(path.join(dir, 'freeflow.json'), 'utf8')))
    } else {
      doc = await writeFixtureSite(dir)
    }
    const result = await build(dir, { quiet: true })
    const site = await serve(result.outDir)
    const chrome = await launch({
      chromePath: process.env.CHROME_PATH ?? chromium.executablePath(),
      chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
    })
    let failed = false
    try {
      for (const route of enumerateRoutes(doc)) {
        const url = `${site.origin}${route.path}`
        const run = await lighthouse(url, {
          port: chrome.port,
          output: 'json',
          onlyCategories: ['performance'],
          logLevel: 'error',
        })
        const lhr = run?.lhr
        const score = Math.round((lhr?.categories.performance?.score ?? 0) * 100)
        const ok = score >= 100
        failed ||= !ok
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(score).padStart(3)}  ${route.path}`)
        if (!ok && lhr) {
          const audits = Object.values(lhr.audits)
            .filter((a) => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative')
            .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
            .slice(0, 5)
          for (const a of audits) console.log(`        ${a.id}: ${a.displayValue ?? a.title}`)
        }
      }
    } finally {
      await chrome.kill()
      await site.close()
    }
    return failed ? 1 : 0
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

process.exitCode = await main()
