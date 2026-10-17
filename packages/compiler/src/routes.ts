import {
  type CollectionListNode,
  type CollectionSchema,
  type Document,
  type Entry,
  type EntryId,
  findEntry,
  localize,
  type PageId,
  publishedLocales,
  siteLocales,
} from '@lacuno/schema'
import { RenderError } from './errors.js'
import { applyQuery } from './query.js'

/**
 * One output path. `listPage` is the page of a paginated list, 2 and on; the first has none.
 * `locale` is the language of the route, absent for the primary.
 */
export type Route = {
  path: string
  page: PageId
  entry?: EntryId
  listPage?: number
  locale?: string
}

export function entrySlug(entry: Entry, collection: CollectionSchema): string {
  return String(entry.fields[collection.slugField])
}

/** `/blog/[slug]` with `hello` becomes `/blog/hello`. Every param segment gets the same slug. */
export function routePath(pagePath: string, slug?: string): string {
  if (slug === undefined) return pagePath
  return pagePath.replace(/\[[a-z0-9-]+\]/g, slug)
}

/**
 * Every output path of the site, sorted: the primary language's, then each other published
 * language's under its prefix, and with `drafts` the draft languages' too. Collection pages
 * expand to one route per entry.
 */
export function enumerateRoutes(doc: Document, options: { drafts?: boolean } = {}): Route[] {
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
  siteLocales(doc).forEach(({ code, draft }, i) => {
    if (draft && !options.drafts) return
    const local = localize(doc, code)
    const lang = i ? { locale: code } : {}
    for (const page of Object.values(local.pages)) {
      if (!page.collection) {
        add({ path: page.path, page: page.id, ...lang })
        const list = paginatedList(local, page.root)
        for (let n = 2; list && n <= listPages(local, list); n++)
          add({ path: listPagePath(page.path, n), page: page.id, listPage: n, ...lang })
        continue
      }
      // parseDocument has already checked that the page's collection exists.
      const collection = local.collections[page.collection]!
      for (const entry of local.entries[page.collection] ?? []) {
        add({
          path: routePath(page.path, entrySlug(entry, collection)),
          page: page.id,
          entry: entry.id,
          ...lang,
        })
      }
    }
  })
  return routes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** A route's page, entry and list page in each published language, the primary first. */
export function alternates(
  doc: Document,
  route: Pick<Route, 'page' | 'entry' | 'listPage'>,
): { locale: string; path: string }[] {
  return publishedLocales(doc).map(({ code }) => {
    const local = localize(doc, code)
    const found = route.entry === undefined ? undefined : findEntry(local, route.entry)
    const slug = found && entrySlug(found.entry, found.collection)
    const path = routePath(local.pages[route.page]!.path, slug)
    return { locale: code, path: listPagePath(path, route.listPage ?? 1) }
  })
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
