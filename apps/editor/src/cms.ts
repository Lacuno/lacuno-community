import type { Operation } from '@lacuno/document'
import type { CollectionSchema, Document, Entry, FieldDef } from '@lacuno/schema'
import { plainText } from '@lacuno/schema'
import { type AssetUse, nodeHome, nodeUse } from './assets.js'

export type FieldType = FieldDef['type']

/** The field types in the order the editor offers them, with the names people know them by. */
export const FIELD_TYPES: [FieldType, string][] = [
  ['text', 'Text'],
  ['richtext', 'Rich text'],
  ['number', 'Number'],
  ['boolean', 'Switch'],
  ['date', 'Date'],
  ['image', 'Image'],
  ['file', 'File'],
  ['color', 'Color'],
  ['option', 'Option'],
  ['reference', 'Reference'],
  ['multi-reference', 'Multi-reference'],
  ['link', 'Link'],
  ['slug', 'Slug'],
]
export const fieldTypeLabel = (type: FieldType) =>
  FIELD_TYPES.find(([value]) => value === type)?.[1] ?? type

/** "Hello, Wörld!" becomes "hello-world": what slugs and paths accept. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** A field name from its label, "Cover image" becomes "coverImage", unique among `taken`. */
export function fieldName(label: string, taken: readonly string[]): string {
  const words = slugify(label).split('-').filter(Boolean)
  let base = words.map((word, i) => (i ? word[0]!.toUpperCase() + word.slice(1) : word)).join('')
  if (!/^[a-z]/.test(base)) base = `field${base[0]?.toUpperCase() ?? ''}${base.slice(1)}`
  let name = base
  for (let n = 2; taken.includes(name); n++) name = `${base}${n}`
  return name
}

/** `base`, or `base-2` and on, whichever no other entry's slug uses. */
export function uniqueSlug(col: CollectionSchema, entries: Entry[], base: string, except = '') {
  const taken = new Set(
    entries.filter((entry) => entry.id !== except).map((entry) => entry.fields[col.slugField]),
  )
  const root = base || 'entry'
  let slug = root
  for (let n = 2; taken.has(slug); n++) slug = `${root}-${n}`
  return slug
}

/** The field that names an entry: `title` or `name` if there is one, else the first text field. */
export function titleField(col: CollectionSchema): FieldDef | undefined {
  const texts = col.fields.filter((field) => field.type === 'text')
  return (
    texts.find((field) => field.name === 'title' || field.name === 'name') ??
    texts[0] ??
    col.fields.find((field) => field.id === col.slugField)
  )
}

export function entryTitle(col: CollectionSchema, entry: Entry): string {
  const field = titleField(col)
  const value = field ? entry.fields[field.id] : undefined
  return typeof value === 'string' && value.trim() ? value : 'Untitled'
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** An entry's value as a short line of text, for the table and pickers. */
export function valueText(doc: Document, field: FieldDef, value: unknown): string {
  if (value === undefined || value === null) return ''
  switch (field.type) {
    case 'boolean':
      return value ? 'Yes' : 'No'
    case 'date': {
      const date = new Date(String(value))
      return Number.isNaN(date.getTime()) ? String(value) : dateFormat.format(date)
    }
    case 'richtext':
      return plainText(value)
    case 'image':
    case 'file':
      return doc.assets[String(value)]?.name ?? ''
    case 'option':
      return field.options.find((option) => option.value === value)?.label ?? String(value)
    case 'reference':
    case 'multi-reference': {
      const target = doc.collections[field.reference]
      const entries = doc.entries[field.reference] ?? []
      const ids = Array.isArray(value) ? value : [value]
      return ids
        .map((id) => entries.find((entry) => entry.id === id))
        .filter((entry) => entry !== undefined)
        .map((entry) => (target ? entryTitle(target, entry) : entry.id))
        .join(', ')
    }
    default:
      return String(value)
  }
}

export type EntrySort = { field: string; direction: 'asc' | 'desc' }

/**
 * The entries whose text contains `search`, in collection order or sorted by one field. Numbers,
 * dates and switches sort by value, everything else by its text.
 */
export function listEntries(
  doc: Document,
  col: CollectionSchema,
  search: string,
  sort?: EntrySort,
): Entry[] {
  const entries = doc.entries[col.id] ?? []
  const query = search.trim().toLowerCase()
  const searchable = col.fields.filter((field) =>
    ['text', 'slug', 'richtext', 'option', 'link'].includes(field.type),
  )
  const found = query
    ? entries.filter((entry) =>
        searchable.some((field) =>
          valueText(doc, field, entry.fields[field.id]).toLowerCase().includes(query),
        ),
      )
    : [...entries]
  const field = col.fields.find((item) => item.id === sort?.field)
  if (!sort || !field) return found
  const key = (entry: Entry) => {
    const value = entry.fields[field.id]
    return ['number', 'date', 'boolean'].includes(field.type)
      ? (value as string | number | boolean | undefined)
      : valueText(doc, field, value).toLowerCase()
  }
  const keyed = found.map((entry) => [key(entry), entry] as const)
  keyed.sort(([a], [b]) => {
    // Empty values go last in either direction.
    if (a === undefined || a === '') return b === undefined || b === '' ? 0 : 1
    if (b === undefined || b === '') return -1
    const order =
      typeof a === 'string' && typeof b === 'string'
        ? a.localeCompare(b, undefined, { numeric: true })
        : a < b
          ? -1
          : a > b
            ? 1
            : 0
    return sort.direction === 'asc' ? order : -order
  })
  return keyed.map(([, entry]) => entry)
}

/** The fields the table shows: the title, the slug and the next few that fit in a cell. */
export function tableFields(col: CollectionSchema): FieldDef[] {
  const title = titleField(col)
  const rest = col.fields.filter(
    (field) => field !== title && field.id !== col.slugField && field.type !== 'richtext',
  )
  return [
    ...(title ? [title] : []),
    ...col.fields.filter((field) => field.id === col.slugField && field !== title),
    ...rest.slice(0, 3),
  ]
}

/** Where a collection, field or entry is used, as people read it. */
export function uses(doc: Document, refs: string[]): AssetUse[] {
  return refs.map((ref): AssetUse => {
    const [kind, key = '', rest = '', index = ''] = ref.split('.')
    // An element on a page reads where it is used by the page's address, like a page does.
    if (kind === 'nodes') {
      const page = nodeHome(doc, key).page
      return { ...nodeUse(doc, key), ...(page ? { place: page.path } : {}) }
    }
    if (kind === 'pages')
      return { label: `${doc.pages[key]?.name ?? key} page`, place: doc.pages[key]?.path ?? '' }
    if (kind === 'collections') {
      const field = doc.collections[key]?.fields.find((item) => item.id === index)
      return { label: `${field?.label ?? index} field`, place: doc.collections[key]?.name ?? key }
    }
    const col = doc.collections[key]
    const entry = doc.entries[key]?.[Number(rest)]
    return {
      label: col && entry ? entryTitle(col, entry) : ref,
      place: col?.name ?? key,
    }
  })
}

/** A new collection with a required title and the slug field its addresses come from. */
export function newCollection(doc: Document, name: string): Operation {
  const taken = Object.values(doc.collections).map((col) => col.slug)
  const base = slugify(name) || 'items'
  let slug = base
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`
  return {
    type: 'collection.create',
    id: `col-${crypto.randomUUID()}`,
    name: name.trim(),
    slug,
    fields: [
      {
        id: `f-${crypto.randomUUID()}`,
        name: 'title',
        label: 'Title',
        type: 'text',
        required: true,
      },
      { id: `f-${crypto.randomUUID()}`, name: 'slug', label: 'Slug', type: 'slug', required: true },
    ],
    slugField: 'slug',
  }
}

/** A field of `type` with what that type needs to start: one option, or a collection to point at. */
export function newField(
  doc: Document,
  col: CollectionSchema,
  type: FieldType,
  label: string,
): FieldDef {
  const base = {
    id: `f-${crypto.randomUUID()}`,
    name: fieldName(
      label,
      col.fields.map((field) => field.name),
    ),
    label: label.trim(),
  }
  if (type === 'option') return { ...base, type, options: [{ value: 'first', label: 'First' }] }
  if (type === 'reference' || type === 'multi-reference')
    return { ...base, type, reference: Object.keys(doc.collections)[0] ?? col.id }
  return { ...base, type }
}

const isEmpty = (field: FieldDef, value: unknown) =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && !value.length) ||
  (field.type === 'richtext' && !plainText(value).trim())

/** What the entry form refuses before it saves, as the editor says it, or '' when it may save. */
export function entryError(
  doc: Document,
  col: CollectionSchema,
  values: Record<string, unknown>,
  except = '',
): string {
  for (const field of col.fields)
    if (field.required && isEmpty(field, values[field.id])) return `Enter ${field.label}.`
  const slug = values[col.slugField]
  const slugLabel = col.fields.find((field) => field.id === col.slugField)?.label ?? 'Slug'
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug))
    return `${slugLabel} may use lowercase letters, numbers and hyphens.`
  if (
    (doc.entries[col.id] ?? []).some(
      (entry) => entry.id !== except && entry.fields[col.slugField] === slug,
    )
  )
    return `Another entry already uses the ${slugLabel.toLowerCase()} ${slug}.`
  return ''
}

/** The form's values to save, every field named: an empty input is null, so it is left unset. */
export function entryFields(col: CollectionSchema, values: Record<string, unknown>) {
  return Object.fromEntries(
    col.fields.map((field) => [
      field.id,
      isEmpty(field, values[field.id]) ? null : values[field.id],
    ]),
  )
}

/** A copy of an entry right after it, named "… copy" with a free slug. */
export function duplicateEntry(doc: Document, col: CollectionSchema, entry: Entry): Operation {
  const entries = doc.entries[col.id] ?? []
  const title = titleField(col)
  const fields = structuredClone(entry.fields)
  if (title && title.id !== col.slugField && typeof fields[title.id] === 'string')
    fields[title.id] = `${fields[title.id]} copy`
  fields[col.slugField] = uniqueSlug(col, entries, `${entry.fields[col.slugField] ?? 'entry'}-copy`)
  return {
    type: 'entry.create',
    collection: col.id,
    id: `e-${crypto.randomUUID()}`,
    fields,
    index: entries.indexOf(entry) + 1,
  }
}
