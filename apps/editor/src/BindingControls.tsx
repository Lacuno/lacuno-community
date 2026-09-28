import type { Operation } from '@lacuno/document'
import {
  type CollectionListNode,
  type CollectionSchema,
  type Document,
  type FieldDef,
  findEntry,
  type Node,
} from '@lacuno/schema'
import { useId, useState } from 'react'
import {
  type BindingSlot,
  bindableFields,
  bindingLabel,
  bindingSource,
  fieldBinding,
  nearbyEntry,
  scopeCollection,
  switchListCollection,
  unboundText,
} from './binding.js'
import { entryTitle } from './cms.js'
import { DateFormatControls, nodeLang } from './DateFormatControls.js'
import { ReferenceInput } from './EntryFields.js'

type Props = {
  doc: Document
  node: Node
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
}

/** Phrasing tags cannot hold the blocks of rich text, so a text bound to it becomes a div. */
const PHRASING = new Set(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

/**
 * Where the element's content comes from: a text, an image and its alt text, or a link can read a
 * field of the entry around it, inside a collection list or on a collection page, or of an entry
 * chosen from the CMS, on any page.
 */
export function BindingControls({ doc, node, disabled, save }: Props) {
  const [picking, setPicking] = useState<BindingSlot>()
  const col = scopeCollection(doc, node.id)
  if (!Object.keys(doc.collections).length || !('tag' in node)) return null
  const slots: [BindingSlot, string, string][] = []
  if (node.type === 'text') slots.push(['text', 'Content from', 'Written text'])
  if (node.type === 'element' && node.tag === 'img')
    slots.push(['src', 'Image from', 'Chosen image'], ['alt', 'Alt text from', 'Written text'])
  if (node.tag === 'a') slots.push(['href', 'Link from', 'Page or address'])
  if (!slots.length) return null
  const current = (slot: BindingSlot) =>
    slot === 'text' ? (node.type === 'text' ? node.text : undefined) : node.attrs?.[slot]
  const bind = (slot: BindingSlot, field: string, entry?: string) => {
    setPicking(undefined)
    const attrs = { ...node.attrs }
    if (slot === 'text' && node.type === 'text') {
      const was = node.text.type === 'field' ? node.text : undefined
      const from = was && bindingSource(doc, node.id, was).collection
      const rich = field && findField(doc, field, entry, col)?.type === 'richtext'
      return save([
        {
          type: 'node.update',
          id: node.id,
          ...(rich && PHRASING.has(node.tag) ? { tag: 'div' } : {}),
          text: field
            ? fieldBinding(field, undefined, entry)
            : was && from
              ? unboundText(doc, from, was.field, was.entry)
              : node.text,
        },
      ])
    }
    if (field) attrs[slot] = fieldBinding(field, undefined, entry)
    else if (slot === 'alt') attrs.alt = { type: 'static', value: '' }
    else delete attrs[slot]
    return save([{ type: 'node.update', id: node.id, attrs }])
  }
  return (
    <div className="binding-controls">
      {slots.map(([slot, label, none]) => {
        const binding = current(slot)
        const bound = binding?.type === 'field' ? binding : undefined
        const field = bound && findField(doc, bound.field, bound.entry, col)
        return (
          <div key={slot} className="binding-row">
            <label>
              {label}
              <select
                aria-label={label}
                value={
                  picking === slot ? 'pick' : bound ? (bound.entry ? 'entry' : bound.field) : ''
                }
                disabled={disabled}
                onChange={(event) => {
                  const value = event.target.value
                  if (value === 'pick') setPicking(slot)
                  else if (value === 'entry' || (!value && !bound)) setPicking(undefined)
                  else void bind(slot, value)
                }}
              >
                <option value="">{none}</option>
                {col &&
                  bindableFields(doc, col, slot).map((item) => (
                    <option key={item.id} value={item.id}>
                      {col.name} · {item.label}
                    </option>
                  ))}
                {bound?.entry && <option value="entry">{bindingLabel(doc, node.id, bound)}</option>}
                <option value="pick">From the CMS…</option>
              </select>
            </label>
            {picking === slot && (
              <EntryPicker
                doc={doc}
                slot={slot}
                start={bound?.entry ?? nearbyEntry(doc, node.id)}
                disabled={disabled}
                choose={(entry, field) => void bind(slot, field, entry)}
                cancel={() => setPicking(undefined)}
              />
            )}
            {field?.type === 'date' && bound && node.type === 'text' && (
              <DateFormatControls
                format={bound.format}
                locale={bound.locale}
                lang={nodeLang(doc, node)}
                disabled={disabled}
                change={(value) =>
                  void save([
                    {
                      type: 'node.update',
                      id: node.id,
                      text: fieldBinding(bound.field, value.format, bound.entry, value.locale),
                    },
                  ])
                }
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** A field of the chosen entry's collection, else of the collection around the node. */
function findField(doc: Document, field: string, entry?: string, col?: CollectionSchema) {
  const source = entry ? findEntry(doc, entry)?.collection : col
  return source?.fields.find((item) => item.id === field)
}

/** Choosing a collection, then one of its entries by searching, then the field to show. */
export function EntryPicker({
  doc,
  slot,
  start,
  disabled,
  choose,
  cancel,
}: {
  doc: Document
  slot: BindingSlot
  start: string | undefined
  disabled: boolean
  choose: (entry: string, field: string) => void
  cancel: () => void
}) {
  const found = start ? findEntry(doc, start) : undefined
  const [collection, setCollection] = useState(
    found?.collection.id ?? Object.keys(doc.collections)[0] ?? '',
  )
  const [entry, setEntry] = useState(found?.entry.id ?? '')
  const id = useId()
  const col = doc.collections[collection]
  if (!col) return null
  const fields = bindableFields(doc, col, slot)
  return (
    <fieldset
      className="entry-picker"
      aria-label="Choose from the CMS"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) cancel()
      }}
    >
      {Object.keys(doc.collections).length > 1 && (
        <select
          aria-label="Collection"
          value={collection}
          disabled={disabled}
          onChange={(event) => {
            setCollection(event.target.value)
            setEntry('')
          }}
        >
          {Object.values(doc.collections).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      )}
      <ReferenceInput
        id={id}
        doc={doc}
        field={{ id: 'entry', name: 'entry', label: 'Entry', type: 'reference', reference: col.id }}
        value={entry || undefined}
        disabled={disabled}
        change={(value) => setEntry(typeof value === 'string' ? value : '')}
      />
      {entry && (
        <select
          aria-label="Field"
          value=""
          disabled={disabled || !fields.length}
          onChange={(event) => choose(entry, event.target.value)}
        >
          <option value="" disabled>
            {fields.length ? 'Choose a field' : 'No field fits here'}
          </option>
          {fields.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      )}
    </fieldset>
  )
}

type Filter = NonNullable<NonNullable<CollectionListNode['query']>['filter']>[number]

const OPERATORS: Record<Filter['op'], string> = {
  eq: 'is',
  ne: 'is not',
  contains: 'contains',
  in: 'is one of',
}

/** The value input a filter on `field` takes. */
function FilterValue({
  doc,
  field,
  value,
  disabled,
  change,
}: {
  doc: Document
  field: FieldDef
  value: unknown
  disabled: boolean
  change: (value: unknown) => void
}) {
  const choices: [string, string][] | undefined =
    field.type === 'option'
      ? field.options.map((option) => [option.value, option.label ?? option.value])
      : field.type === 'boolean'
        ? [
            ['true', 'On'],
            ['false', 'Off'],
          ]
        : field.type === 'reference' || field.type === 'multi-reference'
          ? (doc.entries[field.reference] ?? []).map((entry) => [
              entry.id,
              entryTitle(doc.collections[field.reference]!, entry),
            ])
          : undefined
  if (choices)
    return (
      <select
        aria-label="Filter value"
        value={String(value ?? '')}
        disabled={disabled}
        onChange={(event) =>
          change(field.type === 'boolean' ? event.target.value === 'true' : event.target.value)
        }
      >
        {choices.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    )
  return (
    <input
      aria-label="Filter value"
      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
      defaultValue={String(value ?? '')}
      disabled={disabled}
      onBlur={(event) =>
        change(field.type === 'number' ? event.target.valueAsNumber : event.target.value)
      }
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

/** Which entries a collection list shows: its collection, filters, order, count and pages. */
export function ListSettings({ doc, node, disabled, save }: Props & { node: CollectionListNode }) {
  const col = doc.collections[node.collection]
  const query = node.query ?? {}
  if (!col) return null
  const update = (next: CollectionListNode['query']) => {
    const clean = Object.fromEntries(
      Object.entries(next ?? {}).filter(
        ([, value]) => value !== undefined && !(Array.isArray(value) && !value.length),
      ),
    )
    return save([
      {
        type: 'node.update',
        id: node.id,
        query: Object.keys(clean).length ? clean : null,
      },
    ])
  }
  const filters = query.filter ?? []
  const sort = query.sort?.[0]
  // A new filter starts on what the first entry holds, so it matches something.
  const firstValue = (field: FieldDef): unknown => {
    const value = doc.entries[col.id]?.[0]?.fields[field.id]
    if (field.type === 'multi-reference') return Array.isArray(value) ? value[0] : undefined
    if (value !== undefined && typeof value !== 'object') return value
    return field.type === 'option'
      ? field.options[0]?.value
      : field.type === 'boolean'
        ? true
        : field.type === 'reference'
          ? doc.entries[field.reference]?.[0]?.id
          : ''
  }
  const number = (value: string) => {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
  return (
    <section className="list-settings" aria-label="Collection list">
      <label>
        Collection
        <select
          aria-label="List collection"
          value={col.id}
          disabled={disabled}
          onChange={(event) => {
            const to = doc.collections[event.target.value]
            if (to) void save(switchListCollection(doc, node.id, to))
          }}
        >
          {Object.values(doc.collections).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="list-filters">
        <legend>Filter</legend>
        {filters.map((filter, index) => {
          const field = col.fields.find((item) => item.id === filter.field)
          const set = (next: Partial<Filter>) =>
            void update({
              ...query,
              filter: filters.map((item, i) => (i === index ? { ...item, ...next } : item)),
            })
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: filters are edited by position.
            <div key={index} className="list-filter">
              <select
                aria-label="Filter field"
                value={filter.field}
                disabled={disabled}
                onChange={(event) => {
                  const next = col.fields.find((item) => item.id === event.target.value)!
                  set({ field: next.id, value: firstValue(next) })
                }}
              >
                {col.fields.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter operator"
                value={filter.op}
                disabled={disabled}
                onChange={(event) => set({ op: event.target.value as Filter['op'] })}
              >
                {(['eq', 'ne', 'contains'] as const).map((op) => (
                  <option key={op} value={op}>
                    {OPERATORS[op]}
                  </option>
                ))}
              </select>
              {field && (
                <FilterValue
                  key={`${filter.field}-${String(filter.value)}`}
                  doc={doc}
                  field={field}
                  value={filter.value}
                  disabled={disabled}
                  change={(value) => set({ value })}
                />
              )}
              <button
                type="button"
                className="list-remove"
                aria-label="Remove filter"
                disabled={disabled}
                onClick={() =>
                  void update({ ...query, filter: filters.filter((_, i) => i !== index) })
                }
              >
                ×
              </button>
            </div>
          )
        })}
        <button
          type="button"
          className="list-add"
          disabled={disabled}
          onClick={() => {
            const field = col.fields[0]!
            void update({
              ...query,
              filter: [...filters, { field: field.id, op: 'eq', value: firstValue(field) }],
            })
          }}
        >
          Add filter
        </button>
      </fieldset>
      <div className="list-row">
        <label>
          Sort by
          <select
            aria-label="Sort by"
            value={sort?.field ?? ''}
            disabled={disabled}
            onChange={(event) =>
              void update({
                ...query,
                sort: event.target.value
                  ? [{ field: event.target.value, direction: sort?.direction ?? 'asc' }]
                  : undefined,
              })
            }
          >
            <option value="">Collection order</option>
            {col.fields.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Order
          <select
            aria-label="Sort order"
            value={sort?.direction ?? 'asc'}
            disabled={disabled || !sort}
            onChange={(event) =>
              sort &&
              void update({
                ...query,
                sort: [{ field: sort.field, direction: event.target.value as 'asc' | 'desc' }],
              })
            }
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </label>
      </div>
      <div className="list-row">
        <label>
          Show
          <input
            aria-label="Limit"
            type="number"
            min={1}
            placeholder="All"
            defaultValue={query.limit ?? ''}
            key={`limit-${query.limit}`}
            disabled={disabled}
            onBlur={(event) => {
              const limit = number(event.target.value)
              if (limit !== query.limit)
                void update({ ...query, limit, ...(limit ? {} : { paginate: undefined }) })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </label>
        <label>
          Skip
          <input
            aria-label="Skip"
            type="number"
            min={0}
            placeholder="0"
            defaultValue={query.offset ?? ''}
            key={`offset-${query.offset}`}
            disabled={disabled}
            onBlur={(event) => {
              const offset = number(event.target.value)
              if (offset !== query.offset) void update({ ...query, offset })
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
          />
        </label>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={!!query.paginate}
          disabled={disabled || !query.limit}
          onChange={(event) =>
            void update({ ...query, paginate: event.target.checked || undefined })
          }
        />
        Split into pages
      </label>
    </section>
  )
}
