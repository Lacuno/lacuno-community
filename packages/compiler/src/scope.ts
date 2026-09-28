import type {
  AssetRef,
  Binding,
  CollectionSchema,
  Component,
  Document,
  Entry,
  FieldDef,
  NodeId,
  RichText,
} from '@lacuno/schema'
import { designTokenCssName, findEntry } from '@lacuno/schema'
import { RenderError } from './errors.js'

/** One component instance being rendered. Slot children render in the outer scope. */
export type Frame = {
  instance: NodeId
  component: Component
  values: Record<string, unknown>
  slots: Map<string, NodeId[]>
  outer: Scope
}

export type Scope = {
  entry?: Entry
  collection?: CollectionSchema
  frames: Frame[]
  /** The page's language, for dates. */
  lang?: string
}

/** The address of an entry's page: its collection's page with the entry's slug in the path. */
export function entryPath(doc: Document, collection: string, entry: Entry): string | undefined {
  const page = Object.values(doc.pages).find((p) => p.collection === collection)
  const col = doc.collections[collection]
  const slug = col ? entry.fields[col.slugField] : undefined
  return page && typeof slug === 'string' ? page.path.replace(/\[[a-z0-9-]+\]/g, slug) : undefined
}

/**
 * A field's value as a binding reads it. Images and files become their asset; a date with a
 * format reads in the page's language. For `href`, a slug is the entry's own page and a reference
 * the page of the entry it points at.
 */
function fieldValue(
  doc: Document,
  field: FieldDef,
  entry: Entry,
  collection: string,
  b: Extract<Binding, { type: 'field' }>,
  scope: Scope,
  attr?: string,
): Resolved {
  const value = entry.fields[field.id]
  if (value === undefined) return undefined
  if (attr === 'href' && field.type === 'slug') return entryPath(doc, collection, entry)
  if (attr === 'href' && field.type === 'reference') {
    const target = doc.entries[field.reference]?.find((e) => e.id === value)
    return target && entryPath(doc, field.reference, target)
  }
  if (field.type === 'image' || field.type === 'file') return doc.assets[String(value)]
  if (field.type === 'date' && b.format) {
    const date = new Date(String(value).length === 10 ? `${value}T12:00:00Z` : String(value))
    if (!Number.isNaN(date.getTime()))
      return new Intl.DateTimeFormat(scope.lang, { dateStyle: b.format, timeZone: 'UTC' }).format(
        date,
      )
  }
  if (field.type === 'option')
    return field.options.find((o) => o.value === value)?.label ?? String(value)
  return value as Resolved
}

export type Resolved = string | number | boolean | RichText | AssetRef | undefined

export function resolveBinding(
  doc: Document,
  b: Binding,
  scope: Scope,
  nodeId: string,
  /** The attribute the binding fills, when it fills one. */
  attr?: string,
): Resolved {
  switch (b.type) {
    case 'static':
      return b.value
    case 'designToken': {
      const t = doc.designTokens[b.designToken]
      if (!t) throw new RenderError(`unknown design token ${b.designToken}`, nodeId)
      return `var(${designTokenCssName(t.name)})`
    }
    case 'asset': {
      const a = doc.assets[b.asset]
      if (!a) throw new RenderError(`unknown asset ${b.asset}`, nodeId)
      return a
    }
    case 'field': {
      // A chosen entry, else the entry around the node.
      const found =
        b.entry !== undefined
          ? findEntry(doc, b.entry)
          : scope.entry && scope.collection && { entry: scope.entry, collection: scope.collection }
      if (!found)
        throw new RenderError(
          b.entry !== undefined
            ? `unknown entry ${b.entry}`
            : `field binding ${b.field} outside a collection`,
          nodeId,
        )
      const { entry, collection } = found
      const field = collection.fields.find((f) => f.id === b.field)
      if (!field) throw new RenderError(`unknown field ${b.field}`, nodeId)
      return fieldValue(doc, field, entry, collection.id, b, scope, attr)
    }
    case 'page': {
      const p = doc.pages[b.page]
      if (!p) throw new RenderError(`unknown page ${b.page}`, nodeId)
      // Validation keeps page bindings off collection pages, so this is a real address.
      return p.path
    }
    case 'prop': {
      const frame = scope.frames[scope.frames.length - 1]
      if (!frame) throw new RenderError('prop binding outside a component', nodeId)
      const def = frame.component.props.find((p) => p.name === b.prop)
      if (!def) throw new RenderError(`unknown prop ${b.prop}`, nodeId)
      const v = frame.values[b.prop]
      return (v === undefined ? def.default : v) as Resolved
    }
  }
}
