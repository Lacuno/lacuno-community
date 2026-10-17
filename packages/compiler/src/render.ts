import { classNames, MOTION_SCRIPT, SCRUB_SCRIPT, WORDS_SCRIPT } from '@lacuno/css'
import {
  type AssetRef,
  type Document,
  type Entry,
  findEntry,
  localize,
  type Page,
  pageLang,
  primaryLocale,
  translationKeys,
  translationStatus,
} from '@lacuno/schema'
import { publicAssetPath } from './assets.js'
import { RenderError } from './errors.js'
import { FORM_SCRIPT } from './forms.js'
import { renderHead } from './head.js'
import { renderAttrs } from './html.js'
import type { ImageResolver } from './images.js'
import { motionClasses, type RenderState, renderNode, type Warning } from './nodes.js'
import { alternates, entrySlug, listPagePath, routePath } from './routes.js'
import type { Scope } from './scope.js'

export type RenderContext = {
  resolveImage: ImageResolver
  /** Canvas-only metadata; omitted from published output. */
  annotateNodes?: boolean
  editingComponent?: string
  resolveAsset?: (asset: AssetRef) => string
  texts?: RenderState['texts']
  /** Which page of the page's paginated list to render. */
  listPage?: number
  /** The language to render in, a route's `locale`; the primary when left out. */
  locale?: string
}

export type RenderResult = {
  htmlAttrs: Record<string, string>
  head: string
  body: string
  warnings: Warning[]
}

/** The elements with a value the language lacks, or has from an older primary value: the canvas marks them. */
function untranslated(doc: Document, locale: string): Map<string, 'missing' | 'outdated'> {
  const marks = new Map<string, 'missing' | 'outdated'>()
  for (const { key, context } of translationKeys(doc)) {
    if (!('node' in context) || !context.node || marks.get(context.node) === 'missing') continue
    const status = translationStatus(doc, locale, key)
    if (status !== 'done') marks.set(context.node, status)
  }
  return marks
}

/**
 * Pure: document and page in, head and body HTML out. Never touches the filesystem. In another
 * language than the primary, the page renders from the document as that language shows it.
 */
export function render(
  source: Document,
  sourcePage: Page,
  sourceEntry: Entry | undefined,
  ctx: RenderContext,
): RenderResult {
  const doc = ctx.locale ? localize(source, ctx.locale) : source
  const page = ctx.locale ? doc.pages[sourcePage.id]! : sourcePage
  const entry =
    ctx.locale && sourceEntry ? (findEntry(doc, sourceEntry.id)?.entry ?? sourceEntry) : sourceEntry
  const languages = alternates(source, {
    page: page.id,
    ...(entry ? { entry: entry.id } : {}),
    ...(ctx.listPage ? { listPage: ctx.listPage } : {}),
  })
  const scope: Scope = { frames: [], lang: pageLang(doc, page) }
  let slug: string | undefined
  if (page.collection) {
    // parseDocument has already checked that the page's collection exists.
    const collection = doc.collections[page.collection]!
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
    resolveAsset: ctx.resolveAsset ?? publicAssetPath,
    motion: motionClasses(doc),
    entrances: new Set(
      Object.values(doc.styles)
        .filter((style) => style.property === '--lc-entrance')
        .map((style) => style.class),
    ),
    page: page.id,
    warnings: [],
    ...(ctx.annotateNodes ? { annotateNodes: true } : {}),
    ...(ctx.editingComponent ? { editingComponent: ctx.editingComponent } : {}),
    ...(ctx.texts ? { texts: ctx.texts } : {}),
    ...(ctx.listPage ? { listPage: ctx.listPage } : {}),
    languages,
    locale: ctx.locale ?? languages[0]!.locale,
    ...(ctx.annotateNodes && ctx.locale && ctx.locale !== primaryLocale(source)
      ? { translations: untranslated(source, ctx.locale) }
      : {}),
  }
  const headInput = {
    doc,
    page,
    path: listPagePath(routePath(page.path, slug), ctx.listPage ?? 1),
    ...(entry ? { entry } : {}),
    resolveImage: ctx.resolveImage,
    resolveAsset: state.resolveAsset,
    ...(languages.length > 1 ? { alternates: languages } : {}),
  }
  const head = renderHead(doc.site.url ? { ...headInput, siteUrl: doc.site.url } : headInput)
  const body =
    renderNode(page.root, scope, state) +
    (doc.site.bodyCode ?? '') +
    (page.bodyCode ?? '') +
    (state.entrance ? `<script>${MOTION_SCRIPT}</script>` : '') +
    (!ctx.annotateNodes &&
    Object.values(doc.nodes).some((node) => node.type === 'text' && node.rotatingWords)
      ? `<script>(() => {${WORDS_SCRIPT}})();</script>`
      : '') +
    (state.forms ? `<script>${FORM_SCRIPT}</script>` : '') +
    (state.scrub ? `<script>${SCRUB_SCRIPT}</script>` : '')
  return { htmlAttrs: { lang: pageLang(doc, page) }, head, body, warnings: state.warnings }
}

/** Wraps the parts in a full document. Used by tests; Astro does this in production. */
export function assembleDocument(result: RenderResult): string {
  return `<!doctype html>\n<html${renderAttrs(result.htmlAttrs)}>\n<head>\n${result.head}\n</head>\n<body>${result.body}</body>\n</html>\n`
}
