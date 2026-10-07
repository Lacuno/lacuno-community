import { cp, lstat, readdir, readFile, realpath, rename, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import sitemap from '@astrojs/sitemap'
import { generateStylesheet } from '@lacuno/css'
import { type Document, DocumentError, parseDocument } from '@lacuno/schema'
import { build as astroBuild } from 'astro'
import { publicAssetPath } from './assets.js'
import { BuildError, RenderError } from './errors.js'
import { plainImageResolver } from './images.js'
import type { Warning } from './nodes.js'
import { render } from './render.js'
import { enumerateRoutes } from './routes.js'
import { link, writeScaffold } from './scaffold.js'

export type BuildOptions = {
  /** Defaults to `<siteDir>/dist`. */
  outDir?: string
  /** The site url when the document sets none. */
  siteUrl?: string
  /** Silence Astro's logger. */
  quiet?: boolean
  /**
   * A directory that keeps optimized images between builds of a site whose folder is new each
   * time. Astro names them by source hash and transform, so a hit is the same file. The build
   * starts from a copy and, once it succeeds, leaves exactly the images it output: a failed build
   * never leaves a partial file there, and the cache never outgrows the site's current images.
   */
  imageCache?: string
  /** The largest width an image variant may have; without it, the original's. */
  maxImageWidth?: number
}

export type BuildResult = {
  pages: number
  warnings: Warning[]
  durationMs: number
  outDir: string
  /** The scaffold root, kept after the build for inspection. */
  scaffoldDir: string
}

const require = createRequire(import.meta.url)

function packageDir(name: string): string {
  return path.dirname(require.resolve(`${name}/package.json`))
}

async function loadDocument(siteDir: string): Promise<Document> {
  const file = path.join(siteDir, 'lacuno.json')
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT')
      throw new BuildError('document', `no lacuno.json in ${siteDir}`)
    throw e
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    throw new BuildError('document', `lacuno.json is not valid JSON: ${(e as Error).message}`)
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
  return dir
}

/**
 * Astro's bundled image-generation step imports `sharp` as a bare specifier from a chunk file
 * written under `outDir/.prerender/`, a sibling of the scaffold root (`site/.lacuno/astro`),
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
  if (existing) await rm(at, { force: true })
  await link(target, at)
}

/** Replaces `cache` with the images of `built` that the output uses, all at once. */
async function keepImages(cache: string, built: string, output: string): Promise<void> {
  const used = new Set(await readdir(output).catch(() => []))
  const next = `${cache}.next`
  await rm(next, { recursive: true, force: true })
  await cp(built, next, {
    recursive: true,
    filter: (source) => source === built || used.has(path.basename(source)),
  }).catch((e) => {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  })
  await rm(cache, { recursive: true, force: true })
  await rename(next, cache).catch((e) => {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  })
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
  const root = path.join(site, '.lacuno', 'astro')
  const cacheDir = path.join(site, '.lacuno', 'cache')

  // Reject before any filesystem write: astroBuild's outDir must live inside the site directory
  // (see the comment further down on canonicalizing paths for the Astro call), otherwise nothing
  // guarantees the output ends up somewhere we clear or even somewhere we report back correctly.
  const outDirRel = path.relative(site, outDir)
  if (outDirRel.startsWith('..') || path.isAbsolute(outDirRel))
    throw new BuildError('options', 'outDir must be inside the site directory')
  if (outDirRel === '')
    throw new BuildError('options', 'outDir must be a subdirectory of the site directory')
  const firstSegment = outDirRel.split(path.sep)[0]
  if (
    firstSegment &&
    ['assets', '.lacuno', '.git', 'node_modules', 'skills'].includes(firstSegment.toLowerCase())
  )
    throw new BuildError(
      'options',
      'outDir must not be assets, .lacuno, .git, node_modules or skills',
    )

  // A lexical descendant can still point outside the site through a symlinked parent.
  // Check before writing the scaffold or recursively removing previous build output.
  let outputParent = site
  for (const segment of outDirRel.split(path.sep)) {
    outputParent = path.join(outputParent, segment)
    try {
      if ((await lstat(outputParent)).isSymbolicLink())
        throw new BuildError('options', 'outDir must not traverse symbolic links')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break
      throw error
    }
  }

  const doc = await loadDocument(site)
  // The one place the site url is normalized, whether it came from the file or the option.
  const url = doc.site.url ?? options.siteUrl
  if (url) doc.site.url = url.replace(/\/+$/, '')

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
      warnings.push(
        ...render(doc, page, entry, {
          resolveImage: plainImageResolver,
          ...(route.listPage ? { listPage: route.listPage } : {}),
        }).warnings,
      )
    }
  } catch (e) {
    if (e instanceof RenderError) throw new BuildError('render', renderMessage(e))
    throw e
  }

  // Astro's sitemap already leaves out the not-found page; noindex pages go too.
  const hidden = new Set(routes.filter((r) => doc.pages[r.page]?.seo?.noindex).map((r) => r.path))
  const indexed = (url: string) => !hidden.has(new URL(url).pathname.replace(/(.)\/$/, '$1'))

  const { css } = generateStylesheet(doc, { assetUrl: publicAssetPath })

  await writeScaffold({
    root,
    siteDir: site,
    doc,
    css,
    astroDir: packageDir('astro'),
    compilerDir: packageDir('@lacuno/compiler'),
    ...(options.maxImageWidth ? { maxImageWidth: options.maxImageWidth } : {}),
  })
  await linkSharp(site)

  await rm(outDir, { recursive: true, force: true })
  // Astro's own image cache, `<cacheDir>/assets/<file in _astro>`.
  const images = path.join(cacheDir, 'assets')
  if (options.imageCache) {
    await rm(images, { recursive: true, force: true })
    await cp(options.imageCache, images, { recursive: true }).catch((e) => {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    })
  }

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
      ...(doc.site.url ? { site: doc.site.url, integrations: [sitemap({ filter: indexed })] } : {}),
      redirects: Object.fromEntries(
        doc.redirects.map((r) => [r.from, { status: r.status, destination: r.to }]),
      ),
    })
  } catch (e) {
    throw new BuildError('engine', (e as Error).message, `scaffold kept at ${root}`)
  } finally {
    process.chdir(previousCwd)
  }
  if (options.imageCache) await keepImages(options.imageCache, images, path.join(outDir, '_astro'))

  return {
    pages: routes.length,
    warnings,
    durationMs: Date.now() - started,
    outDir,
    scaffoldDir: root,
  }
}
