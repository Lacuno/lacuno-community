import type { CollectionSchema, Document, Entry, EntryId, PageId } from '@freeflow/schema'
import { RenderError } from './errors.js'

export type Route = { path: string; page: PageId; entry?: EntryId }

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
      continue
    }
    const collection = doc.collections[page.collection]
    if (!collection)
      throw new RenderError(`unknown collection ${page.collection}`, undefined, page.id)
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
