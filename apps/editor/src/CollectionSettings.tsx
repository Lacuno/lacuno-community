import type { Operation } from '@lacuno/document'
import { referencesToCollection, referencesToField } from '@lacuno/document/references'
import type { CollectionSchema, Document, FieldDef, OptionChoice } from '@lacuno/schema'
import { useState } from 'react'
import { collectionPage, collectionPageCreation, listPage, listPageCreation } from './binding.js'
import { FIELD_TYPES, type FieldType, fieldTypeLabel, newField, slugify } from './cms.js'
import { ErrorNote } from './Dialog.js'
import { EditorIcon } from './EditorIcon.js'
import { UseList } from './Entries.js'

type Props = {
  doc: Document
  col: CollectionSchema
  readOnly: boolean
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
  removed: (name: string) => void
  showPage: (id: string) => void
}

/** A collection's name, address and fields, and deleting it. */
export function CollectionSettings({
  doc,
  col,
  readOnly,
  disabled,
  save,
  removed,
  showPage,
}: Props) {
  const page = collectionPage(doc, col.id)
  const list = listPage(doc, col.id)
  const [name, setName] = useState(col.name)
  const [slug, setSlug] = useState(col.slug)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState('')
  const [adding, setAdding] = useState<{ label: string; type: FieldType }>()
  const [confirming, setConfirming] = useState(false)
  const slugFields = col.fields.filter((field) => field.type === 'slug')
  const usedBy = referencesToCollection(doc, col.id)
  const count = doc.entries[col.id]?.length ?? 0
  const run = async (operations: Operation[]) => {
    setError('')
    const saved = await save(operations)
    if (!saved) setError('Could not save. Check the editor message and try again.')
    return saved
  }
  const saveNames = () => {
    const next = { name: name.trim(), slug: slug.trim() }
    if (!next.name) return setError('Enter a collection name.')
    if (!/^[a-z0-9-]+$/.test(next.slug))
      return setError('The URL name may use lowercase letters, numbers and hyphens.')
    if (
      Object.values(doc.collections).some(
        (other) => other.id !== col.id && other.slug === next.slug,
      )
    )
      return setError('Another collection already uses this URL name.')
    if (next.name !== col.name || next.slug !== col.slug)
      void run([{ type: 'collection.update', id: col.id, ...next }])
  }
  const commitOnEnter = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      saveNames()
    }
  }
  return (
    <div className="cms-settings">
      <section className="cms-settings-row">
        <label>
          Collection name
          <input
            value={name}
            readOnly={readOnly}
            disabled={disabled && !readOnly}
            onChange={(event) => setName(event.target.value)}
            onBlur={saveNames}
            onKeyDown={commitOnEnter}
          />
        </label>
        <label>
          URL name
          <input
            className="cms-mono"
            value={slug}
            readOnly={readOnly}
            disabled={disabled && !readOnly}
            onChange={(event) => setSlug(slugify(event.target.value) || event.target.value)}
            onBlur={saveNames}
            onKeyDown={commitOnEnter}
          />
        </label>
        <label>
          Addresses from
          <select
            value={col.slugField}
            disabled={readOnly || disabled || slugFields.length < 2}
            onChange={(event) =>
              void run([{ type: 'collection.update', id: col.id, slugField: event.target.value }])
            }
          >
            {slugFields.map((field) => (
              <option key={field.id} value={field.id}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
      </section>
      <ErrorNote message={error} />
      <div className="cms-pages">
        <span>Entry pages</span>
        {page ? (
          <button type="button" className="text-button" onClick={() => showPage(page.id)}>
            {page.name} <code>{page.path}</code>
          </button>
        ) : readOnly ? (
          <em>None</em>
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={async () => {
              const created = collectionPageCreation(doc, col)
              if (await run(created.operations)) showPage(created.id)
            }}
          >
            Create a page for each entry
          </button>
        )}
        <span>List page</span>
        {list ? (
          <button type="button" className="text-button" onClick={() => showPage(list.id)}>
            {list.name} <code>{list.path}</code>
          </button>
        ) : readOnly ? (
          <em>None</em>
        ) : (
          <button
            type="button"
            disabled={disabled}
            // The list links each entry to its page, so it brings one along when there is none.
            onClick={() =>
              void run([
                ...(page ? [] : collectionPageCreation(doc, col).operations),
                ...listPageCreation(doc, col).operations,
              ])
            }
          >
            Create a list page
          </button>
        )}
      </div>
      <h4 className="cms-heading">
        Fields <span>{col.fields.length}</span>
      </h4>
      <ol className="cms-fields">
        {col.fields.map((field, index) => (
          <li key={field.id} data-open={editing === field.id}>
            <div className="cms-field-row">
              <button
                type="button"
                className="cms-field-summary"
                aria-expanded={editing === field.id}
                aria-label={`${field.label}, ${fieldTypeLabel(field.type)}${field.required ? ', required' : ''}`}
                onClick={() => setEditing(editing === field.id ? '' : field.id)}
              >
                <strong>{field.label}</strong>
                <code>{field.name}</code>
                <span className="cms-type">{fieldTypeLabel(field.type)}</span>
                {field.required && <span className="cms-flag">Required</span>}
                {field.id === col.slugField && <span className="cms-flag">Address</span>}
              </button>
              {!readOnly && (
                <span className="cms-move">
                  <button
                    type="button"
                    aria-label={`Move ${field.label} up`}
                    title="Move up"
                    disabled={disabled || !index}
                    onClick={() =>
                      void run([
                        { type: 'field.move', collection: col.id, id: field.id, index: index - 1 },
                      ])
                    }
                  >
                    <EditorIcon name="up" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${field.label} down`}
                    title="Move down"
                    disabled={disabled || index === col.fields.length - 1}
                    onClick={() =>
                      void run([
                        { type: 'field.move', collection: col.id, id: field.id, index: index + 1 },
                      ])
                    }
                  >
                    <EditorIcon name="down" />
                  </button>
                </span>
              )}
            </div>
            {editing === field.id && (
              <FieldForm
                key={JSON.stringify(field)}
                doc={doc}
                col={col}
                field={field}
                readOnly={readOnly}
                disabled={disabled}
                run={run}
                close={() => setEditing('')}
              />
            )}
          </li>
        ))}
      </ol>
      {!readOnly &&
        (adding ? (
          <form
            className="cms-add-field"
            onSubmit={async (event) => {
              event.preventDefault()
              if (!adding.label.trim()) return setError('Enter a field label.')
              const field = newField(doc, col, adding.type, adding.label)
              if (await run([{ type: 'field.add', collection: col.id, field }])) {
                setAdding(undefined)
                setEditing(field.id)
              }
            }}
          >
            <label>
              Field label
              <input
                // biome-ignore lint/a11y/noAutofocus: Add field opens this form to type into.
                autoFocus
                value={adding.label}
                placeholder="e.g. Cover image"
                onChange={(event) => setAdding({ ...adding, label: event.target.value })}
              />
            </label>
            <label>
              Type
              <select
                aria-label="Field type"
                value={adding.type}
                onChange={(event) =>
                  setAdding({ ...adding, type: event.target.value as FieldType })
                }
              >
                {FIELD_TYPES.map(([type, label]) => (
                  <option key={type} value={type}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="cms-primary" disabled={disabled}>
              Add
            </button>
            <button type="button" onClick={() => setAdding(undefined)}>
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="cms-add"
            disabled={disabled}
            onClick={() => setAdding({ label: '', type: 'text' })}
          >
            <EditorIcon name="plus" />
            Add field
          </button>
        ))}
      {!readOnly && (
        <section className="cms-danger">
          {confirming ? (
            <div className="asset-confirm" role="alertdialog" aria-label="Confirm delete">
              {usedBy.length ? (
                <>
                  <p>
                    {col.name} is used and cannot be deleted. Remove it from these places first:
                  </p>
                  <UseList doc={doc} refs={usedBy} />
                  <div className="asset-confirm-actions">
                    <button type="button" onClick={() => setConfirming(false)}>
                      OK
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>
                    Delete {col.name}
                    {count ? ` and its ${count} ${count === 1 ? 'entry' : 'entries'}` : ''}?
                  </p>
                  <div className="asset-confirm-actions">
                    <button
                      type="button"
                      className="asset-delete"
                      // biome-ignore lint/a11y/noAutofocus: the confirm step takes the focus it asks for.
                      autoFocus
                      disabled={disabled}
                      onClick={async () => {
                        if (await run([{ type: 'collection.delete', id: col.id }]))
                          removed(col.name)
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
          ) : (
            <button
              type="button"
              className="asset-delete"
              disabled={disabled}
              onClick={() => setConfirming(true)}
            >
              Delete collection
            </button>
          )}
        </section>
      )}
    </div>
  )
}

function FieldForm({
  doc,
  col,
  field,
  readOnly,
  disabled,
  run,
  close,
}: {
  doc: Document
  col: CollectionSchema
  field: FieldDef
  readOnly: boolean
  disabled: boolean
  run: (operations: Operation[]) => Promise<boolean>
  close: () => void
}) {
  const [label, setLabel] = useState(field.label)
  const [name, setName] = useState(field.name)
  const [help, setHelp] = useState(field.help ?? '')
  const [required, setRequired] = useState(!!field.required)
  const [options, setOptions] = useState<OptionChoice[]>(
    field.type === 'option' ? field.options : [],
  )
  const [reference, setReference] = useState(
    field.type === 'reference' || field.type === 'multi-reference' ? field.reference : '',
  )
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const usedBy = referencesToField(doc, field.id)
  const locked = readOnly || disabled
  const isSlug = field.id === col.slugField
  const submit = async () => {
    const values = options.map((option) => ({
      value: slugify(option.value) || slugify(option.label ?? ''),
      label: option.label?.trim() || undefined,
    }))
    const issue = !label.trim()
      ? 'Enter a field label.'
      : !/^[a-z][a-zA-Z0-9]*$/.test(name)
        ? 'The field name starts with a lowercase letter and uses only letters and numbers.'
        : col.fields.some((other) => other.id !== field.id && other.name === name)
          ? 'Another field already uses this name.'
          : field.type === 'option' && (!values.length || values.some((option) => !option.value))
            ? 'Give every option a value.'
            : field.type === 'option' &&
                new Set(values.map((option) => option.value)).size < values.length
              ? 'Every option needs its own value.'
              : ''
    setError(issue)
    if (issue) return
    const update: Operation = {
      type: 'field.update',
      collection: col.id,
      id: field.id,
      name,
      label: label.trim(),
      help: help.trim() || null,
      required: required || null,
      ...(field.type === 'option'
        ? { options: values.map((option) => (option.label ? option : { value: option.value })) }
        : {}),
      ...(reference && reference !== (field as { reference?: string }).reference
        ? { reference }
        : {}),
    }
    if (await run([update])) close()
  }
  return (
    <form
      className="cms-field-form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="cms-settings-row">
        <label>
          Label
          <input
            value={label}
            disabled={locked}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label>
          Name
          <input
            className="cms-mono"
            value={name}
            disabled={locked}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </div>
      <label>
        Help text
        <input value={help} disabled={locked} onChange={(event) => setHelp(event.target.value)} />
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={required}
          disabled={locked || isSlug}
          onChange={(event) => setRequired(event.target.checked)}
        />
        Required
      </label>
      {(field.type === 'reference' || field.type === 'multi-reference') && (
        <label>
          Entries of
          <select
            value={reference}
            disabled={locked}
            onChange={(event) => setReference(event.target.value)}
          >
            {Object.values(doc.collections).map((other) => (
              <option key={other.id} value={other.id}>
                {other.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {field.type === 'option' && (
        <fieldset className="cms-options">
          <legend>Options</legend>
          {options.map((option, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: options are edited in place by position.
            <div key={index} className="cms-option">
              <input
                aria-label={`Option ${index + 1} label`}
                placeholder="Label"
                value={option.label ?? ''}
                disabled={locked}
                onChange={(event) =>
                  setOptions(
                    options.map((item, i) =>
                      i === index
                        ? {
                            // A new option's value follows its label.
                            value:
                              item.value && item.value !== slugify(item.label ?? '')
                                ? item.value
                                : slugify(event.target.value),
                            label: event.target.value,
                          }
                        : item,
                    ),
                  )
                }
              />
              <input
                aria-label={`Option ${index + 1} value`}
                className="cms-mono"
                placeholder="value"
                value={option.value}
                disabled={locked}
                onChange={(event) =>
                  setOptions(
                    options.map((item, i) =>
                      i === index ? { ...item, value: event.target.value } : item,
                    ),
                  )
                }
              />
              <button
                type="button"
                aria-label={`Remove option ${index + 1}`}
                disabled={locked || options.length < 2}
                onClick={() => setOptions(options.filter((_, i) => i !== index))}
              >
                <EditorIcon name="close" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="cms-add"
            disabled={locked}
            onClick={() => setOptions([...options, { value: '', label: '' }])}
          >
            <EditorIcon name="plus" />
            Add option
          </button>
        </fieldset>
      )}
      <ErrorNote message={error} />
      {!readOnly && (
        <div className="cms-field-actions">
          <button type="submit" className="cms-primary" disabled={disabled}>
            Save field
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
          {!isSlug && (
            <button
              type="button"
              className="asset-delete"
              disabled={disabled}
              onClick={() => setRemoving(true)}
            >
              Delete field
            </button>
          )}
        </div>
      )}
      {removing && (
        <div className="asset-confirm" role="alertdialog" aria-label="Confirm delete">
          {usedBy.length ? (
            <>
              <p>{field.label} is used and cannot be deleted. Remove it from these places first:</p>
              <UseList doc={doc} refs={usedBy} />
              <div className="asset-confirm-actions">
                <button type="button" onClick={() => setRemoving(false)}>
                  OK
                </button>
              </div>
            </>
          ) : (
            <>
              <p>Delete {field.label} and its value in every entry?</p>
              <div className="asset-confirm-actions">
                <button
                  type="button"
                  className="asset-delete"
                  // biome-ignore lint/a11y/noAutofocus: the confirm step takes the focus it asks for.
                  autoFocus
                  disabled={disabled}
                  onClick={() =>
                    void run([{ type: 'field.remove', collection: col.id, id: field.id }])
                  }
                >
                  Delete
                </button>
                <button type="button" onClick={() => setRemoving(false)}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </form>
  )
}
