import type {
  CollectionListNode,
  CollectionSchema,
  Document,
  Entry,
  EntryId,
  PageId,
} from '@lacuno/schema'
import { RenderError } from './errors.js'
import { applyQuery } from './query.js'

/** One output path. `listPage` is the page of a paginated list, 2 and on; the first has none. */
export type Route = { path: string; page: PageId; entry?: EntryId; listPage?: number }

export function entrySlug(entry: Entry, collection: CollectionSchema): string {
  return String(entry.fields[collection.slugField])
}

/** `/blog/[slug]` with `hello` becomes `/blog/hello`. Every param segment gets the same slug. */
export function routePath(pagePath: string, slug?: string): string {
  if (slug === undefined) return pagePath
  return pagePath.replace(/\[[a-z0-9-]+\]/g, slug)
}

/** Every output path of the site, sorted. Collection pages expand to one route per entry. */
export function enumerateRoutes(doc: Document): Route[] {
  const routes: Route[] = []
  const seen = new Map<string, PageId>()
  const add = (route: Route) => {
    const prev = seen.get(route.path)
    if (prev)
      throw new RenderError(
        `duplicate route ${route.path} from pages ${prev} and ${route.page}`,
        undefined,
        route.page,
      )
    seen.set(route.path, route.page)
    routes.push(route)
  }
  for (const page of Object.values(doc.pages)) {
    if (!page.collection) {
      add({ path: page.path, page: page.id })
      const list = paginatedList(doc, page.root)
      for (let n = 2; list && n <= listPages(doc, list); n++)
        add({ path: listPagePath(page.path, n), page: page.id, listPage: n })
      continue
    }
    // parseDocument has already checked that the page's collection exists.
    const collection = doc.collections[page.collection]!
    for (const entry of doc.entries[page.collection] ?? []) {
      add({
        path: routePath(page.path, entrySlug(entry, collection)),
        page: page.id,
        entry: entry.id,
      })
    }
  }
  return routes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** The paginated list on a page, found by walking its tree; validation allows only one. */
export function paginatedList(doc: Document, root: string): CollectionListNode | undefined {
  const node = doc.nodes[root]
  if (!node) return undefined
  if (node.type === 'collection-list' && node.query?.paginate) return node
  for (const child of node.children) {
    const found = paginatedList(doc, child)
    if (found) return found
  }
  return undefined
}

/** How many pages a paginated list fills: its filtered entries after the offset, per limit. */
export function listPages(doc: Document, list: CollectionListNode): number {
  const { limit = 1, offset = 0, filter } = list.query ?? {}
  const count = applyQuery(
    doc.entries[list.collection] ?? [],
    filter ? { filter } : undefined,
  ).length
  return Math.max(1, Math.ceil((count - offset) / limit))
}

/** `/blog` and 2 become `/blog/page/2`; page 1 is the page's own path. */
export function listPagePath(pagePath: string, n: number): string {
  return n < 2 ? pagePath : `${pagePath === '/' ? '' : pagePath}/page/${n}`
}
