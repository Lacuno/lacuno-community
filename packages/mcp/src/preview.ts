import {
  applyQuery,
  assembleDocument,
  enumerateRoutes,
  type Frame,
  plainImageResolver,
  publicAssetPath,
  render,
  resolveBinding,
  routePath,
  type Scope,
} from '@freeflow/compiler'
import { generateStylesheet } from '@freeflow/css'
import type { Document, Entry, NodeId, Page, RichText } from '@freeflow/schema'
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
  result.head += `\n<style>${css.replace(/</g, '\\3c ')}</style>`
  return assembleDocument(result)
}

/** Rich text as plain text: inline content joined, blocks separated by a space. */
export function plainText(n: unknown): string {
  const o = n as { type?: string; text?: string; content?: unknown[] }
  if (typeof o.text === 'string') return o.text
  const inline = o.type === 'paragraph' || o.type === 'heading' || o.type === 'codeBlock'
  return (o.content ?? []).map(plainText).join(inline ? '' : ' ')
}

/** `nodeId<TAB>text` per rendered text node in document order, walking components and lists. */
export function previewText(doc: Document, route: PreviewRoute): string[] {
  const lines: string[] = []
  const visit = (id: NodeId, scope: Scope) => {
    // parseDocument has already checked every node, component and collection reference.
    const node = doc.nodes[id]!
    switch (node.type) {
      case 'text': {
        const v = node.text.type === 'doc' ? node.text : resolveBinding(doc, node.text, scope, id)
        // Rich text becomes plain text, an asset has no text, anything else reads as a string.
        const s = (
          (v as RichText | null)?.type === 'doc'
            ? plainText(v)
            : typeof v === 'object'
              ? ''
              : String(v ?? '')
        )
          .replace(/\s+/g, ' ')
          .trim()
        if (s) lines.push(`${id}\t${s}`)
        return
      }
      case 'component': {
        const component = doc.components[node.component]!
        const slots = new Map<string, NodeId[]>()
        for (const c of node.children) {
          const slot = doc.nodes[c]?.attrs?.slot
          const name = slot?.type === 'static' ? String(slot.value) : 'default'
          slots.set(name, [...(slots.get(name) ?? []), c])
        }
        const values = Object.fromEntries(
          Object.entries(node.props ?? {}).map(([k, b]) => [k, resolveBinding(doc, b, scope, id)]),
        )
        const frame: Frame = { instance: id, component, values, slots, outer: scope }
        visit(component.root, { ...scope, frames: [...scope.frames, frame] })
        return
      }
      case 'slot': {
        const frame = scope.frames[scope.frames.length - 1]
        const content = frame?.slots.get(node.name)
        if (frame && content?.length) for (const c of content) visit(c, frame.outer)
        else for (const c of node.children) visit(c, scope)
        return
      }
      case 'collection-list': {
        const collection = doc.collections[node.collection]!
        for (const entry of applyQuery(doc.entries[node.collection] ?? [], node.query))
          for (const c of node.children) visit(c, { ...scope, entry, collection })
        return
      }
      default:
        for (const c of node.children) visit(c, scope)
    }
  }
  const { page, entry } = route
  visit(
    page.root,
    entry ? { entry, collection: doc.collections[page.collection!]!, frames: [] } : { frames: [] },
  )
  return lines
}
