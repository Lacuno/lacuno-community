import { copyFile, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { CssValue, Document } from '@freeflow/schema'
import { assetFileName, isOptimizedImage } from './assets.js'
import { BuildError } from './errors.js'

export type ScaffoldInput = {
  /** The Astro project root, normally `<siteDir>/.freeflow/astro`. Cleared on every write. */
  root: string
  siteDir: string
  doc: Document
  css: string
  /** Installed `astro` package directory, linked as `node_modules/astro`. */
  astroDir: string
  /** The compiler package directory, linked as `node_modules/@freeflow/compiler`. */
  compilerDir: string
}

/**
 * The one route in the scaffold. It is a fixed string, never generated from the document, so
 * the only thing that varies between sites is data. Keep it small and boring.
 */
export const ROUTE_SOURCE = `---
import { getImage } from 'astro:assets'
import {
  enumerateRoutes,
  imageResolverFrom,
  parseDocument,
  render,
  resolveAllImages,
} from '@freeflow/compiler/render'
import raw from '../data/document.json'
import '../styles/site.css'

export function getStaticPaths() {
  return enumerateRoutes(parseDocument(raw)).map((route) => ({
    params: { path: route.path === '/' ? undefined : route.path.slice(1) },
    props: { route },
  }))
}

const doc = parseDocument(raw)
const metas = import.meta.glob('../assets/*', { eager: true, import: 'default' })
const images = await resolveAllImages(doc, metas, getImage)
const { route } = Astro.props
const page = doc.pages[route.page]
const entry = route.entry
  ? (doc.entries[page.collection] ?? []).find((e) => e.id === route.entry)
  : undefined
const result = render(doc, page, entry, { resolveImage: imageResolverFrom(images) })
---
<html {...result.htmlAttrs}>
  <head><Fragment set:html={result.head} /></head>
  <body><Fragment set:html={result.body} /></body>
</html>
`

function collectImageAssets(value: CssValue, into: Set<string>): void {
  switch (value.type) {
    case 'image':
      into.add(value.asset)
      return
    case 'list':
      for (const v of value.values) collectImageAssets(v, into)
      return
    case 'fn':
      for (const v of value.args) collectImageAssets(v, into)
      return
    default:
      return
  }
}

/** Asset ids used by `url()` values in styles. These must exist under public/ unoptimized. */
export function cssImageAssets(doc: Document): Set<string> {
  const out = new Set<string>()
  for (const decl of Object.values(doc.styles)) collectImageAssets(decl.value, out)
  return out
}

function robots(siteUrl: string | undefined): string {
  const base = 'User-agent: *\nAllow: /\n'
  return siteUrl ? `${base}Sitemap: ${siteUrl.replace(/\/+$/, '')}/sitemap-index.xml\n` : base
}

async function link(target: string, at: string): Promise<void> {
  await mkdir(path.dirname(at), { recursive: true })
  await symlink(target, at, process.platform === 'win32' ? 'junction' : 'dir')
}

export async function writeScaffold(input: ScaffoldInput): Promise<void> {
  const { root, siteDir, doc } = input
  await rm(root, { recursive: true, force: true })
  for (const d of ['src/pages', 'src/styles', 'src/data', 'src/assets', 'public/assets']) {
    await mkdir(path.join(root, d), { recursive: true })
  }
  await link(input.astroDir, path.join(root, 'node_modules', 'astro'))
  await link(input.compilerDir, path.join(root, 'node_modules', '@freeflow', 'compiler'))
  await writeFile(path.join(root, 'src/pages/[...path].astro'), ROUTE_SOURCE)
  await writeFile(path.join(root, 'src/styles/site.css'), input.css)
  await writeFile(path.join(root, 'src/data/document.json'), JSON.stringify(doc))
  await writeFile(path.join(root, 'public/robots.txt'), robots(doc.site.url))

  const inCss = cssImageAssets(doc)
  for (const asset of Object.values(doc.assets)) {
    const source = path.join(siteDir, 'assets', asset.hash)
    const file = assetFileName(asset)
    const targets: string[] = []
    if (isOptimizedImage(asset)) targets.push(path.join(root, 'src/assets', file))
    // The favicon is linked by its public URL, so it must exist unoptimized like a css image.
    if (!isOptimizedImage(asset) || inCss.has(asset.id) || doc.site.favicon === asset.id)
      targets.push(path.join(root, 'public/assets', file))
    for (const target of targets) {
      try {
        await copyFile(source, target)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT')
          throw new BuildError(
            'render',
            `asset ${asset.id} (${asset.name}) not found at assets/${asset.hash}`,
          )
        throw e
      }
    }
  }
}
