import type { Operation } from '@lacuno/document'
import { referencesToEntry } from '@lacuno/document/references'
import { assetUrl } from '@lacuno/renderer'
import type { CollectionSchema, Document, Entry } from '@lacuno/schema'
import { useEffect, useMemo, useState } from 'react'
import {
  duplicateEntry,
  type EntrySort,
  entryError,
  entryFields,
  entryTitle,
  listEntries,
  slugify,
  tableFields,
  titleField,
  uniqueSlug,
  uses,
  valueText,
} from './cms.js'
import { ErrorNote } from './Dialog.js'
import { EditorIcon } from './EditorIcon.js'
import { FieldInput } from './EntryFields.js'

const PAGE_SIZE = 50

export type EntryContext = {
  siteId: string
  doc: Document
  col: CollectionSchema
  readOnly: boolean
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
  undo: () => void
  upload: (file: File) => Promise<string | undefined>
}

/** The entries of one collection: a table to find them, a form to edit one. */
export function Entries(
  props: EntryContext & {
    open: string
    setOpen: (id: string) => void
    setDirty: (dirty: boolean) => void
  },
) {
  const { doc, col, readOnly, disabled, undo, open, setOpen } = props
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<EntrySort>()
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState('')
  const entries = useMemo(() => listEntries(doc, col, search, sort), [doc, col, search, sort])
  const columns = tableFields(col)
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const shown = entries.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE)
  const total = doc.entries[col.id]?.length ?? 0
  if (open)
    return (
      <EntryForm
        key={open}
        {...props}
        entry={doc.entries[col.id]?.find((entry) => entry.id === open)}
        close={(message = '') => {
          setStatus(message)
          setOpen('')
        }}
      />
    )
  return (
    <div className="cms-entries">
      <div className="asset-toolbar">
        <input
          type="search"
          aria-label="Search entries"
          placeholder="Search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(0)
          }}
        />
        {status && (
          <p className="asset-status" role="status">
            {status}
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              onClick={() => {
                setStatus('')
                undo()
              }}
            >
              Undo
            </button>
          </p>
        )}
        {!readOnly && (
          <button
            type="button"
            className="cms-primary"
            disabled={disabled}
            onClick={() => setOpen('new')}
          >
            <EditorIcon name="plus" />
            New entry
          </button>
        )}
      </div>
      {shown.length ? (
        <div className="cms-table-wrap">
          <table className="cms-table" aria-label={`${col.name} entries`}>
            <thead>
              <tr>
                {columns.map((field) => {
                  const direction = sort?.field === field.id ? sort.direction : undefined
                  return (
                    <th
                      key={field.id}
                      aria-sort={
                        direction ? (direction === 'asc' ? 'ascending' : 'descending') : undefined
                      }
                    >
                      <button
                        type="button"
                        className="cms-sort"
                        onClick={() =>
                          setSort(
                            direction === 'desc'
                              ? undefined
                              : { field: field.id, direction: direction ? 'desc' : 'asc' },
                          )
                        }
                      >
                        {field.label}
                        <span aria-hidden="true">
                          {direction === 'asc' ? '↑' : direction === 'desc' ? '↓' : ''}
                        </span>
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => (
                <tr key={entry.id}>
                  {columns.map((field, index) => {
                    const text = valueText(doc, field, entry.fields[field.id])
                    return index ? (
                      <td key={field.id} data-type={field.type}>
                        {field.type === 'color' && text ? (
                          <span className="color-swatch" style={{ background: text }} />
                        ) : null}
                        {field.type === 'image' && text ? (
                          <img
                            className="cms-thumb"
                            src={assetUrl(
                              props.siteId,
                              doc.assets[entry.fields[field.id] as string]!,
                              320,
                            )}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          text
                        )}
                      </td>
                    ) : (
                      <th key={field.id} scope="row">
                        <button
                          type="button"
                          className="cms-open"
                          onClick={() => setOpen(entry.id)}
                        >
                          {entryTitle(col, entry)}
                        </button>
                      </th>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="asset-empty">
          <p>
            {total
              ? 'No entry matches your search.'
              : readOnly
                ? `${col.name} has no entries yet.`
                : `No entries yet. Add the first of your ${col.name.toLowerCase()} with New entry.`}
          </p>
        </div>
      )}
      <footer className="cms-pager">
        <span>
          {entries.length
            ? `${current * PAGE_SIZE + 1}–${current * PAGE_SIZE + shown.length} of ${entries.length}`
            : ''}
        </span>
        {pages > 1 && (
          <span>
            <button
              type="button"
              aria-label="Previous page"
              disabled={!current}
              onClick={() => setPage(current - 1)}
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              ›
            </button>
          </span>
        )}
      </footer>
    </div>
  )
}

function EntryForm({
  siteId,
  doc,
  col,
  readOnly,
  disabled,
  save,
  upload,
  entry,
  setOpen,
  setDirty,
  close,
}: EntryContext & {
  entry: Entry | undefined
  setOpen: (id: string) => void
  setDirty: (dirty: boolean) => void
  close: (message?: string) => void
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    structuredClone(entry?.fields ?? {}),
  )
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  // A new entry's slug follows its title until someone types a slug of their own.
  const [slugFollows, setSlugFollows] = useState(!entry)
  const title = titleField(col)
  const entries = doc.entries[col.id] ?? []
  const dirty =
    JSON.stringify(entryFields(col, values)) !==
    JSON.stringify(entryFields(col, entry?.fields ?? {}))
  useEffect(() => {
    setDirty(dirty)
    return () => setDirty(false)
  }, [dirty, setDirty])
  const usedBy = entry ? referencesToEntry(doc, col.id, entry.id) : []
  const change = (fieldId: string, value: unknown) =>
    setValues((previous) => {
      const next = { ...previous, [fieldId]: value }
      if (fieldId === col.slugField) setSlugFollows(false)
      else if (slugFollows && fieldId === title?.id)
        next[col.slugField] = uniqueSlug(col, entries, slugify(String(value ?? '')))
      return next
    })
  const back = () => {
    if (!dirty || window.confirm('Discard your unsaved changes?')) {
      setDirty(false)
      close()
    }
  }
  async function submit() {
    const issue = entryError(doc, col, values, entry?.id)
    setError(issue)
    if (issue) return
    const fields = entryFields(col, values)
    const id = `e-${crypto.randomUUID()}`
    const saved = await save([
      entry
        ? { type: 'entry.update', collection: col.id, id: entry.id, fields }
        : { type: 'entry.create', collection: col.id, id, fields },
    ])
    if (!saved) setError('Could not save the entry. Check the editor message and try again.')
    else if (!entry) setOpen(id)
  }
  const name = entry ? entryTitle(col, entry) : 'New entry'
  return (
    <form
      className="cms-entry"
      aria-label={name}
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          back()
        }
      }}
    >
      <header className="cms-entry-header">
        <button type="button" className="cms-back" onClick={back}>
          <EditorIcon name="back" />
          {col.name}
        </button>
        <h3>{name}</h3>
        {!readOnly && entry && (
          <>
            <button
              type="button"
              disabled={disabled || dirty}
              onClick={async () => {
                const copy = duplicateEntry(doc, col, entry)
                if (copy.type === 'entry.create' && (await save([copy]))) setOpen(copy.id!)
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="asset-delete"
              disabled={disabled}
              onClick={() => setConfirming(true)}
            >
              Delete
            </button>
          </>
        )}
        {!readOnly && (
          <button type="submit" className="cms-primary" disabled={disabled || (!!entry && !dirty)}>
            {entry ? 'Save' : 'Create entry'}
          </button>
        )}
      </header>
      {confirming && entry && (
        <div className="asset-confirm" role="alertdialog" aria-label="Confirm delete">
          {usedBy.length ? (
            <>
              <p>{name} is used and cannot be deleted. Remove it from these places first:</p>
              <UseList doc={doc} refs={usedBy} />
              <div className="asset-confirm-actions">
                <button type="button" onClick={() => setConfirming(false)}>
                  OK
                </button>
              </div>
            </>
          ) : (
            <>
              <p>Delete {name}?</p>
              <div className="asset-confirm-actions">
                <button
                  type="button"
                  className="asset-delete"
                  // biome-ignore lint/a11y/noAutofocus: the confirm step takes the focus it asks for.
                  autoFocus
                  disabled={disabled}
                  onClick={async () => {
                    if (await save([{ type: 'entry.delete', collection: col.id, id: entry.id }]))
                      close(`Deleted ${name}.`)
                  }}
                >
                  Delete
                </button>
                <button type="button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <ErrorNote message={error} />
      <div className="cms-entry-fields">
        {col.fields.map((field) => (
          <FieldInput
            key={field.id}
            siteId={siteId}
            doc={doc}
            field={field}
            value={values[field.id]}
            disabled={readOnly || disabled}
            change={(value) => change(field.id, value)}
            upload={upload}
          />
        ))}
      </div>
    </form>
  )
}

/** Where something is used, one line per place. */
export function UseList({ doc, refs }: { doc: Document; refs: string[] }) {
  return (
    <ul className="asset-uses">
      {uses(doc, refs).map((use, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: two uses may read the same.
        <li key={index}>
          <div>
            <span>{use.label}</span>
            <small>{use.place}</small>
          </div>
        </li>
      ))}
    </ul>
  )
}
