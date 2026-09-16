import { lstat, mkdir, readFile, realpath, rm, stat, symlink } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sitemap from '@astrojs/sitemap'
import { generateStylesheet } from '@freeflow/css'
import { type Document, DocumentError, parseDocument } from '@freeflow/schema'
import { build as astroBuild } from 'astro'
import { publicAssetPath } from './assets.js'
import { BuildError, RenderError } from './errors.js'
import { plainImageResolver } from './images.js'
import type { Warning } from './nodes.js'
import { render } from './render.js'
import { enumerateRoutes } from './routes.js'
import { writeScaffold } from './scaffold.js'

export type BuildOptions = {
  /** Defaults to `<siteDir>/dist`. */
  outDir?: string
  /** Overrides the document's site url. */
  siteUrl?: string
  /** Silence Astro's logger. */
  quiet?: boolean
}

export type BuildResult = {
  pages: number
  warnings: Warning[]
  durationMs: number
  outDir: string
  /** The scaffold root, kept after the build for inspection. */
  cacheDir: string
}

const require = createRequire(import.meta.url)

function packageDir(name: string, fallback: URL): string {
  try {
    return path.dirname(require.resolve(`${name}/package.json`))
  } catch {
    return fileURLToPath(fallback)
  }
}

async function loadDocument(siteDir: string): Promise<Document> {
  const file = path.join(siteDir, 'freeflow.json')
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      throw new BuildError('document', `no freeflow.json in ${siteDir}`)
    throw e
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new BuildError('document', `freeflow.json is not valid JSON: ${(e as Error).message}`)
  }
  try {
    return parseDocument(json)
  } catch (e) {
    if (e instanceof DocumentError) throw new BuildError('document', e.message)
    throw e
  }
}

function renderMessage(e: RenderError): string {
  const where = [e.node && `node ${e.node}`, e.page && `page ${e.page}`].filter(Boolean).join(', ')
  return where ? `${e.message} (${where})` : e.message
}

/**
 * sharp's package.json does not expose an `./package.json` export, so `require.resolve` on it
 * (the trick `packageDir` uses for astro and the compiler) always throws. Resolve the main entry
 * instead and walk up to the directory whose package.json actually names it "sharp".
 */
async function sharpDir(): Promise<string> {
  let entry: string
  try {
    entry = require.resolve('sharp')
  } catch {
    throw new BuildError('engine', 'sharp is not installed; run pnpm install')
  }
  let dir = path.dirname(entry)
  for (;;) {
    try {
      const pkg: unknown = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'))
      if (pkg && typeof pkg === 'object' && (pkg as { name?: unknown }).name === 'sharp') break
    } catch {
      // No package.json here (or it's unrelated/malformed): keep walking up.
    }
    const parent = path.dirname(dir)
    if (parent === dir) throw new BuildError('engine', 'sharp is not installed; run pnpm install')
    dir = parent
  }
  try {
    await stat(dir)
  } catch {
    throw new BuildError('engine', 'sharp is not installed; run pnpm install')
  }
  return dir
}

/**
 * Astro's bundled image-generation step imports `sharp` as a bare specifier from a chunk file
 * written under `outDir/.prerender/`, a sibling of the scaffold root (`site/.freeflow/astro`),
 * not a descendant of it. Node resolves that bare specifier by walking up from the chunk's own
 * location, so the symlink has to sit where both `outDir` and the scaffold root can reach it:
 * directly under the site directory itself.
 *
 * Never touches a real (non-symlink) `node_modules/sharp` the site folder might already have.
 */
async function linkSharp(site: string): Promise<void> {
  const at = path.join(site, 'node_modules', 'sharp')
  let existing: Awaited<ReturnType<typeof lstat>> | undefined
  try {
    existing = await lstat(at)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  if (existing && !existing.isSymbolicLink()) return
  const target = await sharpDir()
  await mkdir(path.dirname(at), { recursive: true })
  if (existing) await rm(at, { force: true })
  await symlink(target, at, process.platform === 'win32' ? 'junction' : 'dir')
}

/**
 * Site folder in, static output out. Every failure is a BuildError.
 *
 * Side effects: creates or updates a `node_modules/sharp` symlink inside the site directory so
 * Astro's image pipeline can resolve it, and temporarily changes the process's working directory
 * for the duration of the Astro build call (restored afterward) — so this function is not safe
 * to call concurrently with another `build()` in the same process.
 */
export async function build(siteDir: string, options: BuildOptions = {}): Promise<BuildResult> {
  const started = Date.now()
  const site = path.resolve(siteDir)
  const outDir = path.resolve(options.outDir ?? path.join(site, 'dist'))
  const root = path.join(site, '.freeflow', 'astro')
  const cacheDir = path.join(site, '.freeflow', 'cache')

  // Reject before any filesystem write: astroBuild's outDir must live inside the site directory
  // (see the comment further down on canonicalizing paths for the Astro call), otherwise nothing
  // guarantees the output ends up somewhere we clear or even somewhere we report back correctly.
  const outDirRel = path.relative(site, outDir)
  if (outDirRel.startsWith('..') || path.isAbsolute(outDirRel))
    throw new BuildError('options', 'outDir must be inside the site directory')
  if (outDirRel === '')
    throw new BuildError('options', 'outDir must be a subdirectory of the site directory')
  const firstSegment = outDirRel.split(path.sep)[0]
  if (firstSegment && ['assets', '.freeflow', 'node_modules', 'skills'].includes(firstSegment))
    throw new BuildError('options', 'outDir must not be assets, .freeflow, node_modules or skills')

  const doc = await loadDocument(site)
  if (options.siteUrl) doc.site.url = options.siteUrl.replace(/\/+$/, '')

  // Dry render every route before Astro runs: catches reference errors early and collects
  // warnings, which Astro's build would otherwise swallow.
  const warnings: Warning[] = []
  let routes: ReturnType<typeof enumerateRoutes>
  try {
    routes = enumerateRoutes(doc)
    for (const route of routes) {
      const page = doc.pages[route.page]
      if (!page) throw new RenderError(`unknown page ${route.page}`, undefined, route.page)
      const entry = route.entry
        ? (doc.entries[page.collection ?? ''] ?? []).find((e) => e.id === route.entry)
        : undefined
      warnings.push(...render(doc, page, entry, { resolveImage: plainImageResolver }).warnings)
    }
  } catch (e) {
    if (e instanceof RenderError) throw new BuildError('render', renderMessage(e))
    throw e
  }

  const { css } = generateStylesheet(doc, {
    assetUrl: (id) => {
      const asset = doc.assets[id]
      return asset ? publicAssetPath(asset) : undefined
    },
  })

  await writeScaffold({
    root,
    siteDir: site,
    doc,
    css,
    astroDir: packageDir('astro', new URL('../node_modules/astro/', import.meta.url)),
    compilerDir: packageDir('@freeflow/compiler', new URL('..', import.meta.url)),
  })
  await linkSharp(site)

  await rm(outDir, { recursive: true, force: true })

  // Astro's static build only writes the SSR/prerender bundle that carries each page's
  // stylesheet next to outDir when outDir is a literal string prefix of process.cwd(); otherwise
  // it silently falls back to a `.astro/` scratch directory and the page's CSS never reaches the
  // final HTML. That string comparison does not see through a symlink (e.g. macOS's
  // /tmp -> /private/tmp), so cd into the site's real path for the build only, and pass Astro
  // paths built from that same real path. `outDir`/`root`/`cacheDir` above stay as requested for
  // the return value; only the Astro call itself needs the canonical form.
  const realSite = await realpath(site).catch(() => site)
  const previousCwd = process.cwd()
  try {
    process.chdir(realSite)
    await astroBuild({
      root: path.join(realSite, path.relative(site, root)),
      outDir: path.join(realSite, path.relative(site, outDir)),
      cacheDir: path.join(realSite, path.relative(site, cacheDir)),
      configFile: false,
      logLevel: options.quiet ? 'silent' : 'warn',
      output: 'static',
      compressHTML: true,
      build: { inlineStylesheets: 'auto' },
      ...(doc.site.url ? { site: doc.site.url, integrations: [sitemap()] } : {}),
      redirects: Object.fromEntries(
        doc.redirects.map((r) => [r.from, { status: r.status, destination: r.to }]),
      ),
    })
  } catch (e) {
    throw new BuildError('engine', (e as Error).message, `scaffold kept at ${root}`)
  } finally {
    process.chdir(previousCwd)
  }

  return {
    pages: routes.length,
    warnings,
    durationMs: Date.now() - started,
    outDir,
    cacheDir: root,
  }
}
