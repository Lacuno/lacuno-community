import { type Document, Page } from '@freeflow/schema'
import { type EditOperation, type PageTree, pageTree } from './history.js'

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

export function duplicatePage(doc: Document, id: string) {
  const source = doc.pages[id]!
  const root = pageTree(doc, source.root)
  const operations: EditOperation[] = []
  const locals = new Map<string, string>()
  const copy = (tree: PageTree) => {
    tree.id = `n-${crypto.randomUUID()}`
    tree.classes = tree.classes.map((id) => {
      const cls = doc.classes[id]
      if (cls?.kind !== 'local') return id
      if (!locals.has(id)) {
        const next = `c-${crypto.randomUUID()}`
        locals.set(id, next)
        operations.push({ type: 'class.create', id: next, local: true })
        for (const style of Object.values(doc.styles).filter((style) => style.class === id))
          operations.push({ type: 'style.set', ...structuredClone(style), class: next })
      }
      return locals.get(id)!
    })
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
