import { Document, findEntry } from './document.js'
import { nodeBindings } from './nodes.js'
import { BASE_BREAKPOINT_ID, styleKey } from './styles.js'

export type Issue = { path: string; message: string }

/**
 * Referential checks Zod cannot express: every id that points somewhere must land, every tree
 * must be consistent, exactly one default mode, and style keys must match their declarations.
 * Returns issues instead of throwing so tools can report all of them at once.
 */
export function checkReferences(doc: Document): Issue[] {
  const issues: Issue[] = []
  const add = (path: string, message: string) => issues.push({ path, message })

  const defaults = doc.site.modes.filter((m) => m.default)
  if (defaults.length !== 1)
    add('site.modes', `expected exactly one default mode, found ${defaults.length}`)
  const modeIds = new Set(doc.site.modes.map((m) => m.id))

  if (!doc.breakpoints[BASE_BREAKPOINT_ID])
    add('breakpoints', `missing base breakpoint "${BASE_BREAKPOINT_ID}"`)

  for (const [key, decl] of Object.entries(doc.styles)) {
    if (styleKey(decl) !== key)
      add(`styles.${key}`, `key does not match declaration ${styleKey(decl)}`)
    if (!doc.classes[decl.class]) add(`styles.${key}`, `unknown class ${decl.class}`)
    if (!doc.breakpoints[decl.breakpoint])
      add(`styles.${key}`, `unknown breakpoint ${decl.breakpoint}`)
  }

  for (const [id, cls] of Object.entries(doc.classes)) {
    if (cls.kind === 'class' && !cls.name) add(`classes.${id}`, 'named class without a name')
    for (const parent of cls.combo ?? []) {
      if (!doc.classes[parent]) add(`classes.${id}`, `unknown combo parent ${parent}`)
      if (parent === id) add(`classes.${id}`, 'class cannot be its own combo parent')
    }
  }

  for (const [id, designToken] of Object.entries(doc.designTokens)) {
    for (const mode of Object.keys(designToken.values)) {
      if (!modeIds.has(mode)) add(`designTokens.${id}`, `unknown mode ${mode}`)
    }
  }

  for (const [id, node] of Object.entries(doc.nodes)) {
    if (node.id !== id) add(`nodes.${id}`, `node id mismatch ${node.id}`)
    if (node.parent !== null) {
      const parent = doc.nodes[node.parent]
      if (!parent) add(`nodes.${id}`, `unknown parent ${node.parent}`)
      else if (!parent.children.includes(id))
        add(`nodes.${id}`, `parent ${node.parent} does not list it as a child`)
    }
    for (const child of node.children) {
      const c = doc.nodes[child]
      if (!c) add(`nodes.${id}`, `unknown child ${child}`)
      else if (c.parent !== id) add(`nodes.${id}`, `child ${child} has parent ${c.parent}`)
    }
    for (const cls of node.classes) {
      if (!doc.classes[cls]) add(`nodes.${id}`, `unknown class ${cls}`)
    }
    for (const b of nodeBindings(node)) {
      if (b.type === 'field' && b.entry !== undefined) {
        const found = findEntry(doc, b.entry)
        if (!found) add(`nodes.${id}`, `unknown entry ${b.entry}`)
        else if (!found.collection.fields.some((f) => f.id === b.field))
          add(`nodes.${id}`, `field ${b.field} is not a field of ${found.collection.id}`)
      }
      if (b.type !== 'page') continue
      const page = doc.pages[b.page]
      if (!page) add(`nodes.${id}`, `unknown page ${b.page}`)
      // A collection page has no single address to link to.
      else if (page.collection) add(`nodes.${id}`, `page ${b.page} is a collection page`)
    }
    if (node.type === 'component' && !doc.components[node.component])
      add(`nodes.${id}`, `unknown component ${node.component}`)
    if (node.type === 'collection-list' && !doc.collections[node.collection])
      add(`nodes.${id}`, `unknown collection ${node.collection}`)
  }

  const paginated = new Map<string, string>()
  for (const [id, node] of Object.entries(doc.nodes)) {
    const scope = bindingScope(doc, id)
    if (!scope) continue
    for (const b of nodeBindings(node)) {
      if (b.type !== 'field' || b.entry !== undefined) continue
      const col = scope.collection ? doc.collections[scope.collection] : undefined
      if (!scope.collection) add(`nodes.${id}`, `field binding ${b.field} outside a collection`)
      else if (col && !col.fields.some((f) => f.id === b.field))
        add(`nodes.${id}`, `field ${b.field} is not a field of ${scope.collection}`)
    }
    if (node.type !== 'collection-list' || !node.query?.paginate) continue
    if (node.query.limit === undefined) add(`nodes.${id}`, 'a paginated list needs a limit')
    if (scope.page?.collection) add(`nodes.${id}`, 'a collection page cannot paginate a list')
    const other = scope.page && paginated.get(scope.page.id)
    if (other) add(`nodes.${id}`, `page ${scope.page!.id} already paginates list ${other}`)
    if (scope.page) paginated.set(scope.page.id, id)
  }

  const paths = new Map<string, string>()
  for (const [id, page] of Object.entries(doc.pages)) {
    const root = doc.nodes[page.root]
    if (!root) add(`pages.${id}`, `unknown root node ${page.root}`)
    else if (root.parent !== null) add(`pages.${id}`, 'root node must have no parent')
    if (page.collection && !doc.collections[page.collection])
      add(`pages.${id}`, `unknown collection ${page.collection}`)
    if (page.collection && !page.path.includes('['))
      add(`pages.${id}`, 'collection page path needs a [param]')
    const seoEntry = page.seo?.entry
    if (seoEntry !== undefined && page.collection)
      add(`pages.${id}`, 'a collection page reads seo.fields from each entry, not seo.entry')
    else if (seoEntry !== undefined && !findEntry(doc, seoEntry))
      add(`pages.${id}`, `unknown entry ${seoEntry}`)
    const seoCol = page.collection
      ? doc.collections[page.collection]
      : seoEntry !== undefined
        ? findEntry(doc, seoEntry)?.collection
        : undefined
    for (const [key, field] of Object.entries(page.seo?.fields ?? {})) {
      if (!page.collection && seoEntry === undefined)
        add(`pages.${id}`, `seo.fields.${key} needs a collection page or seo.entry`)
      else if (seoCol && !seoCol.fields.some((f) => f.id === field))
        add(`pages.${id}`, `seo.fields.${key}: ${field} is not a field of ${seoCol.id}`)
    }
    if (page.folder && !doc.folders[page.folder])
      add(`pages.${id}`, `unknown folder ${page.folder}`)
    const prev = paths.get(page.path)
    if (prev) add(`pages.${id}`, `path ${page.path} already used by ${prev}`)
    paths.set(page.path, id)
  }

  for (const [id, comp] of Object.entries(doc.components)) {
    const root = doc.nodes[comp.root]
    if (!root) add(`components.${id}`, `unknown root node ${comp.root}`)
    else if (root.parent !== null) add(`components.${id}`, 'component root must have no parent')
  }

  for (const [id, col] of Object.entries(doc.collections)) {
    if (!col.fields.some((f) => f.id === col.slugField))
      add(`collections.${id}`, `slugField ${col.slugField} is not a field`)
    for (const f of col.fields) {
      if ((f.type === 'reference' || f.type === 'multi-reference') && !doc.collections[f.reference])
        add(
          `collections.${id}.fields.${f.name}`,
          `reference field ${f.name} points at unknown collection ${f.reference}`,
        )
    }
  }

  for (const [colId, entries] of Object.entries(doc.entries)) {
    const col = doc.collections[colId]
    if (!col) {
      add(`entries.${colId}`, `unknown collection ${colId}`)
      continue
    }
    const slugs = new Map<string, string>()
    entries.forEach((entry, index) => {
      const path = `entries.${colId}.${index}`
      for (const f of col.fields) {
        const value = entry.fields[f.id]
        if (f.required && value === undefined) add(path, `missing required field ${f.name}`)
        if (f.type === 'option' && value !== undefined && !f.options.some((o) => o.value === value))
          add(path, `${JSON.stringify(value)} is not an option of field ${f.name}`)
      }
      for (const fieldId of Object.keys(entry.fields)) {
        if (!col.fields.some((f) => f.id === fieldId)) add(path, `unknown field ${fieldId}`)
      }
      const slug = entry.fields[col.slugField]
      if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) {
        add(path, `slug must be a lower-case string, got ${JSON.stringify(slug)}`)
      } else if (slugs.has(slug)) {
        add(path, `duplicate slug ${slug}`)
      } else {
        slugs.set(slug, entry.id)
      }
    })
  }

  return issues
}

/**
 * The collection whose entry a node's field bindings read: the nearest collection list around it,
 * else its page's collection. A list's own attributes read the scope around the list. Undefined
 * for nodes of a component, whose scope depends on where it is used.
 */
export function bindingScope(
  doc: Document,
  nodeId: string,
): { collection?: string; page?: Document['pages'][string] } | undefined {
  let id = doc.nodes[nodeId]?.parent ?? null
  let root = nodeId
  let collection: string | undefined
  while (id !== null) {
    const node = doc.nodes[id]
    if (!node) return undefined
    if (node.type === 'collection-list' && collection === undefined) collection = node.collection
    root = id
    id = node.parent
  }
  const page = Object.values(doc.pages).find((p) => p.root === root)
  if (!page) return undefined
  collection ??= page.collection
  return collection ? { collection, page } : { page }
}

export class DocumentError extends Error {
  constructor(public issues: Issue[]) {
    super(`invalid document:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')}`)
    this.name = 'DocumentError'
  }
}

/**
 * Documents written before element states stored hover styles as `--ff-hover-*` custom
 * properties. Rewrite them into the real declarations the style panel now writes. Removable
 * once no document predates the release that added element states.
 */
function migrateHoverShortcut(doc: Document): void {
  for (const [key, decl] of Object.entries(doc.styles)) {
    if (decl.state !== 'none' || !decl.property.startsWith('--ff-hover-')) continue
    delete doc.styles[key]
    const property = decl.property.slice('--ff-hover-'.length)
    for (const state of ['hover', 'focus-visible'] as const) {
      const moved = { ...decl, state, property }
      // An explicit declaration for the same state wins over the shortcut.
      doc.styles[styleKey(moved)] ??= moved
    }
  }
}

/** Parse unknown JSON into a Document, running both Zod and referential checks. Throws. */
export function parseDocument(input: unknown): Document {
  const result = Document.safeParse(input)
  if (!result.success) {
    throw new DocumentError(
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    )
  }
  migrateHoverShortcut(result.data)
  const issues = checkReferences(result.data)
  if (issues.length) throw new DocumentError(issues)
  return result.data
}
