import type { Operation } from '@freeflow/document'
import { type Document, Page, type Seo } from '@freeflow/schema'
import { localClassCopier } from './copyLocalClasses.js'
import { type PageTree, pageTree } from './history.js'

export function pagePathError(doc: Document, path: string, except?: string) {
  if (!Page.shape.path.safeParse(path).success)
    return 'Use a path such as /about or /company/team, with lowercase letters, numbers and hyphens.'
  const page = except ? doc.pages[except] : undefined
  if (!page?.collection && path.includes('['))
    return 'Only collection pages can use path parameters.'
  if (page?.collection && !path.includes('['))
    return 'Keep the collection parameter, such as [slug], in the path.'
  if (Object.values(doc.pages).some((other) => other.id !== except && other.path === path))
    return 'Another page already uses this path.'
  return ''
}

function isHttpUrl(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/** The public URL is an origin: a path, query or trailing slash would break derived URLs. */
export function siteUrlError(value: string) {
  return !value || (isHttpUrl(value) && new URL(value).origin === value)
    ? ''
    : 'Enter the address the site is published at, such as https://example.com, without a trailing slash.'
}

export function canonicalError(value: string) {
  return !value || isHttpUrl(value)
    ? ''
    : 'Enter a full address, such as https://example.com/about.'
}

export function redirectError(doc: Document, from: string, to: string) {
  if (!/^\/[^\s?#]*$/.test(from)) return 'Redirect from a path on this site, such as /old-page.'
  if (!/^\/\S*$/.test(to) && !isHttpUrl(to))
    return 'Redirect to a path such as /new-page or a full address.'
  if (from === to) return 'A page cannot redirect to itself.'
  if (doc.redirects.some((r) => r.from === from)) return 'This path already redirects.'
  return ''
}

/** The page's SEO with the form's values over it and every cleared field removed. */
export function pageSeo(page: Page | undefined, form: Required<Seo>): Seo {
  const seo: Record<string, unknown> = { ...page?.seo, ...form }
  for (const key in seo) if (!seo[key]) delete seo[key]
  return seo
}

export function duplicatePage(doc: Document, id: string) {
  const source = doc.pages[id]!
  const root = pageTree(doc, source.root)
  const operations: Operation[] = []
  const copyClasses = localClassCopier(doc, operations)
  const copy = (tree: PageTree) => {
    tree.id = `n-${crypto.randomUUID()}`
    tree.classes = copyClasses(tree.classes)
    tree.children.forEach(copy)
  }
  copy(root)
  const base =
    source.path === '/' ? '/home-copy' : source.path.replace(/(\/\[[^/]+\])?$/, '-copy$1')
  let path = base
  let suffix = 2
  while (Object.values(doc.pages).some((page) => page.path === path)) {
    path = base.replace(/(\/\[[^/]+\])?$/, `-${suffix++}$1`)
  }
  const page = {
    ...structuredClone(source),
    id: `p-${crypto.randomUUID()}`,
    name: `${source.name} copy`,
    path,
    root,
  }
  operations.push({ type: 'page.create', ...page })
  return { id: page.id, operations }
}
