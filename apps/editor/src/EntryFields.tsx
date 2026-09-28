import type { Document, FieldDef, RichText } from '@lacuno/schema'
import { lazy, Suspense, useId, useState } from 'react'
import { ASSET_ACCEPT, AssetPreview } from './AssetsPanel.js'
import { entryTitle } from './cms.js'
import { pickerHex } from './colors.js'
import { ImageLibrary } from './ImageLibrary.js'

const RichTextField = lazy(() =>
  import('./RichTextField.js').then((module) => ({ default: module.RichTextField })),
)

export type FieldProps = {
  siteId: string
  doc: Document
  field: FieldDef
  value: unknown
  disabled: boolean
  change: (value: unknown) => void
  /** Stores a file and registers it as an asset; resolves to its id. */
  upload: (file: File) => Promise<string | undefined>
}

/** The input an entry field's type calls for, labelled with the field's label. */
export function FieldInput(props: FieldProps) {
  const { field, value, disabled, change } = props
  const id = useId()
  const text = typeof value === 'string' ? value : ''
  const control = (() => {
    switch (field.type) {
      case 'richtext':
        return (
          <Suspense fallback={<p className="hint">Opening text editor…</p>}>
            <RichTextField
              label={field.label}
              value={value as RichText | undefined}
              disabled={disabled}
              change={change}
            />
          </Suspense>
        )
      case 'number':
        return (
          <input
            id={id}
            type="number"
            step="any"
            value={typeof value === 'number' ? value : ''}
            disabled={disabled}
            onChange={(event) =>
              change(event.target.value === '' ? undefined : event.target.valueAsNumber)
            }
          />
        )
      case 'boolean':
        return (
          <button
            id={id}
            type="button"
            role="switch"
            className="cms-switch"
            aria-checked={value === true}
            disabled={disabled}
            onClick={() => change(value !== true)}
          >
            <span aria-hidden="true" />
            {value === true ? 'On' : 'Off'}
          </button>
        )
      case 'date':
        return (
          <input
            id={id}
            type="date"
            value={text.slice(0, 10)}
            disabled={disabled}
            onChange={(event) => change(event.target.value || undefined)}
          />
        )
      case 'color':
        return (
          <div className="cms-color">
            <span className="color-swatch" style={{ background: text || 'transparent' }} />
            <input
              id={id}
              aria-label={field.label}
              value={text}
              placeholder="#6952d9"
              disabled={disabled}
              onChange={(event) => change(event.target.value)}
            />
            <input
              type="color"
              aria-label={`${field.label} picker`}
              value={pickerHex(text, '#6952d9')}
              disabled={disabled}
              onChange={(event) => change(event.target.value)}
            />
          </div>
        )
      case 'option':
        return (
          <select
            id={id}
            value={text}
            disabled={disabled}
            onChange={(event) => change(event.target.value || undefined)}
          >
            <option value="">{field.required ? 'Choose…' : 'None'}</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label ?? option.value}
              </option>
            ))}
          </select>
        )
      case 'image':
      case 'file':
        return <AssetInput {...props} id={id} />
      case 'reference':
      case 'multi-reference':
        return <ReferenceInput {...props} id={id} />
      default:
        return (
          <input
            id={id}
            value={text}
            disabled={disabled}
            placeholder={field.type === 'link' ? 'https://… or /page' : undefined}
            className={field.type === 'slug' ? 'cms-mono' : undefined}
            onChange={(event) => change(event.target.value)}
          />
        )
    }
  })()
  // A group of controls is named by a heading; a single control by its label.
  const grouped = ['richtext', 'color', 'image', 'file', 'reference', 'multi-reference'].includes(
    field.type,
  )
  const help = field.help && <p className="hint">{field.help}</p>
  return grouped ? (
    <fieldset className="cms-field" data-type={field.type}>
      <legend className="cms-field-label" data-required={field.required}>
        {field.label}
      </legend>
      {control}
      {help}
    </fieldset>
  ) : (
    <div className="cms-field" data-type={field.type}>
      <label htmlFor={id} className="cms-field-label" data-required={field.required}>
        {field.label}
      </label>
      {control}
      {help}
    </div>
  )
}

function AssetInput({
  siteId,
  doc,
  field,
  value,
  disabled,
  change,
  upload,
  id,
}: FieldProps & { id: string }) {
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const asset = typeof value === 'string' ? doc.assets[value] : undefined
  const kind = field.type === 'image' ? 'image' : 'file'
  return (
    <div className="cms-asset" id={id}>
      <div className="cms-asset-preview">
        {asset ? <AssetPreview siteId={siteId} asset={asset} /> : <span>None</span>}
      </div>
      <div className="cms-asset-actions">
        {asset && <strong>{asset.name}</strong>}
        <div>
          <button type="button" disabled={disabled} onClick={() => setOpen(true)}>
            Choose
          </button>
          <label className="cms-upload" data-disabled={disabled || uploading}>
            {uploading ? 'Uploading…' : 'Upload'}
            <input
              type="file"
              aria-label={`Upload ${field.label.toLowerCase()}`}
              accept={kind === 'image' ? 'image/png,image/jpeg,image/webp,image/gif' : ASSET_ACCEPT}
              disabled={disabled || uploading}
              onChange={async (event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (!file) return
                setUploading(true)
                const assetId = await upload(file).finally(() => setUploading(false))
                if (assetId) change(assetId)
              }}
            />
          </label>
          {asset && (
            <button type="button" disabled={disabled} onClick={() => change(undefined)}>
              Remove
            </button>
          )}
        </div>
      </div>
      {open && (
        <ImageLibrary
          siteId={siteId}
          doc={doc}
          kind={kind}
          selected={typeof value === 'string' ? value : ''}
          choose={(assetId) => {
            change(assetId)
            setOpen(false)
          }}
          close={() => setOpen(false)}
        />
      )}
    </div>
  )
}

/** Picks one entry, or several, of the field's collection by searching their titles. */
function ReferenceInput({ doc, field, value, disabled, change, id }: FieldProps & { id: string }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  if (field.type !== 'reference' && field.type !== 'multi-reference') return null
  const target = doc.collections[field.reference]
  const entries = doc.entries[field.reference] ?? []
  const multi = field.type === 'multi-reference'
  const chosen = (
    Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  ) as string[]
  const title = (entryId: string) => {
    const entry = entries.find((item) => item.id === entryId)
    return entry && target ? entryTitle(target, entry) : 'Missing entry'
  }
  const needle = query.trim().toLowerCase()
  const matches = target
    ? entries
        .filter((entry) => !chosen.includes(entry.id))
        .filter((entry) => entryTitle(target, entry).toLowerCase().includes(needle))
        .slice(0, 8)
    : []
  const pick = (entryId: string) => {
    change(multi ? [...chosen, entryId] : entryId)
    setQuery('')
    setActive(0)
    setOpen(multi)
  }
  const listId = `${id}-options`
  return (
    <div className="cms-reference">
      {chosen.length > 0 && (
        <ul className="cms-chips">
          {chosen.map((entryId) => (
            <li key={entryId}>
              {title(entryId)}
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${title(entryId)}`}
                  onClick={() =>
                    change(multi ? chosen.filter((item) => item !== entryId) : undefined)
                  }
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (multi || !chosen.length) && (
        <div className="cms-combobox">
          <input
            id={id}
            role="combobox"
            aria-label={field.label}
            aria-expanded={open && matches.length > 0}
            aria-controls={listId}
            aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            placeholder={`Search ${target?.name.toLowerCase() ?? 'entries'}`}
            value={query}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
              setOpen(true)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setOpen(true)
                const step = event.key === 'ArrowDown' ? 1 : -1
                setActive((index) => Math.max(0, Math.min(matches.length - 1, index + step)))
              } else if (event.key === 'Enter' && open && matches[active]) {
                event.preventDefault()
                pick(matches[active].id)
              } else if (event.key === 'Escape' && open) {
                event.preventDefault()
                setOpen(false)
              }
            }}
          />
          {open && matches.length > 0 && (
            <div id={listId} role="listbox" aria-label={`${field.label} choices`}>
              {matches.map((entry, index) => (
                // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input handles the keys.
                <div
                  key={entry.id}
                  id={`${listId}-${index}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(entry.id)}
                >
                  {entryTitle(target!, entry)}
                </div>
              ))}
            </div>
          )}
          {open && needle && !matches.length && <p className="cms-no-match">No entry matches.</p>}
        </div>
      )}
    </div>
  )
}
