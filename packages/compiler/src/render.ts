import { classNames, MOTION_SCRIPT } from '@freeflow/css'
import type { AssetRef, Document, Entry, Page } from '@freeflow/schema'
import { RenderError } from './errors.js'
import { renderHead } from './head.js'
import { renderAttrs } from './html.js'
import type { ImageResolver } from './images.js'
import { type RenderState, renderNode, type Warning } from './nodes.js'
import { entrySlug, routePath } from './routes.js'
import type { Scope } from './scope.js'

export type RenderContext = {
  resolveImage: ImageResolver
  /** Canvas-only metadata; omitted from published output. */
  annotateNodes?: boolean
  resolveAsset?: (asset: AssetRef) => string
  /** Overrides `doc.site.url`. */
  siteUrl?: string
}

export type RenderResult = {
  htmlAttrs: Record<string, string>
  head: string
  body: string
  warnings: Warning[]
}

function normalizeSiteUrl(url: string | undefined): string | undefined {
  return url ? url.replace(/\/+$/, '') : undefined
}

/** Pure: document and page in, head and body HTML out. Never touches the filesystem. */
export function render(
  doc: Document,
  page: Page,
  entry: Entry | undefined,
  ctx: RenderContext,
): RenderResult {
  const scope: Scope = { frames: [] }
  let slug: string | undefined
  if (page.collection) {
    const collection = doc.collections[page.collection]
    if (!collection)
      throw new RenderError(`unknown collection ${page.collection}`, undefined, page.id)
    if (!entry)
      throw new RenderError(
        `collection page ${page.id} rendered without an entry`,
        undefined,
        page.id,
      )
    scope.entry = entry
    scope.collection = collection
    slug = entrySlug(entry, collection)
  }
  const state: RenderState = {
    doc,
    names: classNames(doc),
    resolveImage: ctx.resolveImage,
    page: page.id,
    warnings: [],
    ...(ctx.annotateNodes ? { annotateNodes: true } : {}),
    ...(ctx.resolveAsset ? { resolveAsset: ctx.resolveAsset } : {}),
  }
  const siteUrl = normalizeSiteUrl(ctx.siteUrl ?? doc.site.url)
  const headInput = {
    doc,
    page,
    path: routePath(page.path, slug),
    resolveImage: ctx.resolveImage,
    ...(ctx.resolveAsset ? { resolveAsset: ctx.resolveAsset } : {}),
  }
  const head = renderHead(siteUrl ? { ...headInput, siteUrl } : headInput)
  const body =
    renderNode(page.root, scope, state) +
    (doc.site.bodyCode ?? '') +
    (page.bodyCode ?? '') +
    (!ctx.annotateNodes &&
    Object.values(doc.styles).some((style) => style.property === '--ff-entrance')
      ? `<script>${MOTION_SCRIPT}</script>`
      : '')
  return { htmlAttrs: { lang: doc.site.locale }, head, body, warnings: state.warnings }
}

/** Wraps the parts in a full document. Used by tests; Astro does this in production. */
export function assembleDocument(result: RenderResult): string {
  return `<!doctype html>\n<html${renderAttrs(result.htmlAttrs)}>\n<head>\n${result.head}\n</head>\n<body>${result.body}</body>\n</html>\n`
}
