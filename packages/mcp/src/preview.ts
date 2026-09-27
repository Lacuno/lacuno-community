import {
  assembleDocument,
  enumerateRoutes,
  plainImageResolver,
  publicAssetPath,
  type Resolved,
  render,
  routePath,
} from '@lacuno/compiler'
import { generateStylesheet, styleElement } from '@lacuno/css'
import {
  type Document,
  type Entry,
  type NodeId,
  type Page,
  plainText,
  type RichText,
} from '@lacuno/schema'
import { InputError } from './errors.js'

export type PreviewRoute = { page: Page; entry?: Entry }

/** A page id, a page path or a route path; a collection page also needs an entry id or slug. */
export function resolveRoute(doc: Document, page: string, entry?: string): PreviewRoute {
  const routes = enumerateRoutes(doc)
  const route = routes.find((r) => {
    const p = doc.pages[r.page]!
    if (r.path === page) return true
    if (p.id !== page && p.path !== page) return false
    return !r.entry || r.entry === entry || r.path === routePath(p.path, entry)
  })
  if (!route)
    throw new InputError(
      `no route for ${page}${entry === undefined ? '' : ` entry ${entry}`}; routes: ${routes
        .map((r) => `${r.path} (${r.page}${r.entry ? ` entry ${r.entry}` : ''})`)
        .join(', ')}`,
    )
  const p = doc.pages[route.page]!
  const e = doc.entries[p.collection ?? '']?.find((e) => e.id === route.entry)
  return e ? { page: p, entry: e } : { page: p }
}

/**
 * The route's full HTML with the site stylesheet inlined and assets at their public paths,
 * unoptimised. `annotateNodes` adds the canvas's node ids, and is otherwise the published markup.
 */
export function previewHtml(doc: Document, route: PreviewRoute, annotateNodes = false): string {
  const result = render(doc, route.page, route.entry, {
    resolveImage: plainImageResolver,
    ...(annotateNodes ? { annotateNodes } : {}),
  })
  const { css } = generateStylesheet(doc, { assetUrl: publicAssetPath })
  result.head += `\n${styleElement(css)}`
  return assembleDocument(result)
}

/** `nodeId<TAB>text` per rendered text node in document order. */
export function previewText(doc: Document, route: PreviewRoute): string[] {
  const texts: [NodeId, Resolved][] = []
  render(doc, route.page, route.entry, { resolveImage: plainImageResolver, texts })
  return texts.flatMap(([id, v]) => {
    // Rich text becomes plain text, an asset has no text, anything else reads as a string.
    const s = (
      (v as RichText | undefined)?.type === 'doc'
        ? plainText(v)
        : typeof v === 'object'
          ? ''
          : String(v ?? '')
    )
      .replace(/\s+/g, ' ')
      .trim()
    return s ? [`${id}\t${s}`] : []
  })
}
