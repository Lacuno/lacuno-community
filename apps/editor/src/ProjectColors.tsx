import { type Operation, referencesToDesignToken } from '@freeflow/document'
import { type Document, designTokenCssName } from '@freeflow/schema'
import { useEffect, useState } from 'react'
import type { LivePreview } from './Canvas.js'
import {
  colorLabel,
  colorPreview,
  colorTokenName,
  defaultMode,
  pickerHex,
  projectColors,
} from './colors.js'
import { Dialog, ErrorNote } from './Dialog.js'
import { useAutosave } from './useAutosave.js'

export function ProjectColors({
  doc,
  busy,
  conflict,
  error,
  dirtyChanged,
  save,
  close,
  leave,
  autoSave,
  previewChanged,
  registerFlush,
}: {
  doc: Document
  busy: boolean
  conflict: boolean
  error: string
  dirtyChanged: (value: boolean) => void
  save: (ops: Operation[]) => Promise<boolean>
  close: () => void
  leave: (action: () => void) => Promise<void>
  autoSave: (ops: Operation[]) => Promise<boolean>
  previewChanged: (preview: LivePreview) => void
  registerFlush: (flush: () => Promise<boolean>) => () => void
}) {
  const [selected, setSelected] = useState('')
  const [family, setFamily] = useState('')
  const [reset, setReset] = useState(0)
  // Leaving saves or discards the draft; the counter starts the next form from the saved color.
  const switchTo = (action: () => void) =>
    void leave(() => {
      setReset((value) => value + 1)
      action()
    })
  return (
    <Dialog
      title="Project colors"
      description="Reusable colors for your entire site."
      className="colors-dialog"
      closeLabel="Close colors"
      disabled={busy}
      close={() => switchTo(close)}
    >
      <div className="colors-layout">
        <nav aria-label="Project palette">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              switchTo(() => {
                setSelected('')
                setFamily('')
              })
            }
          >
            New color
          </button>
          {projectColors(doc).map((token) => (
            <button
              type="button"
              className={`palette-item ${selected === token.id ? 'active' : ''}`}
              key={token.id}
              disabled={busy}
              onClick={() =>
                switchTo(() => {
                  setSelected(token.id)
                  setFamily('')
                })
              }
            >
              <span className="color-swatch" style={{ background: colorPreview(doc, token.id) }} />
              <span>{colorLabel(token.name)}</span>
            </button>
          ))}
        </nav>
        <ColorForm
          key={`${selected}-${family}-${reset}`}
          doc={doc}
          selected={selected}
          family={family}
          busy={busy}
          conflict={conflict}
          dirtyChanged={dirtyChanged}
          save={save}
          autoSave={autoSave}
          previewChanged={previewChanged}
          registerFlush={registerFlush}
          created={(id) => {
            setSelected(id)
            setFamily('')
          }}
          variant={() =>
            switchTo(() => {
              setFamily(doc.designTokens[selected]!.name)
              setSelected('')
            })
          }
        />
      </div>
      <ErrorNote message={error} />
      {conflict && (
        <p className="note">Close colors, then reload the latest site before continuing.</p>
      )}
    </Dialog>
  )
}

function ColorForm({
  doc,
  selected,
  family,
  busy,
  conflict,
  dirtyChanged,
  save,
  created,
  variant,
  autoSave,
  previewChanged,
  registerFlush,
}: {
  doc: Document
  selected: string
  family: string
  busy: boolean
  conflict: boolean
  dirtyChanged: (dirty: boolean) => void
  save: (ops: Operation[]) => Promise<boolean>
  created: (id: string) => void
  variant: () => void
  autoSave: (ops: Operation[]) => Promise<boolean>
  previewChanged: (preview: LivePreview) => void
  registerFlush: (flush: () => Promise<boolean>) => () => void
}) {
  const token = doc.designTokens[selected]
  const [name, setName] = useState('')
  const [mode, setMode] = useState(defaultMode(doc))
  const original = token ? colorPreview(doc, selected, mode) : '#6952d9'
  const [value, setValue] = useState(original)
  const [validation, setValidation] = useState('')
  const dirty = name !== '' || value !== original
  const valid =
    CSS.supports('color', value.trim()) &&
    !/var\(|currentcolor|inherit|initial|unset|revert/i.test(value)
  // A new color exists only once it is created, so its fields stay editable while a save runs.
  const disabled = conflict || (busy && !token)
  const operations: Operation[] =
    token && dirty && valid
      ? [
          {
            type: 'designToken.setValue',
            id: token.id,
            mode,
            value: { type: 'color', value: value.trim() },
          },
        ]
      : []
  const autosave = useAutosave(operations, !!token && valid && !conflict, busy, autoSave, {
    dirty,
    dirtyChanged,
    registerFlush,
  })
  const previewKey = JSON.stringify(
    token && valid ? { colors: { [designTokenCssName(token.name)]: value } } : {},
  )
  useEffect(() => {
    previewChanged(JSON.parse(previewKey))
    return () => previewChanged({})
  }, [previewKey, previewChanged])
  const uses = token
    ? referencesToDesignToken(doc, token.id)
        .filter((reference) => reference.startsWith('styles.'))
        .map((reference) => doc.styles[reference.replace('styles.', '')]!)
    : []
  return (
    <form
      className="color-form"
      onSubmit={async (event) => {
        event.preventDefault()
        setValidation('')
        if (busy || conflict) return
        if (!valid) {
          setValidation('Enter a color such as #6952d9, rgb(105 82 217), or rebeccapurple.')
          return
        }
        if (token) {
          await autosave.flush()
          return
        }
        try {
          const id = `dt-${crypto.randomUUID()}`
          const tokenName = colorTokenName(doc, name, family || undefined)
          if (
            await save([
              {
                type: 'designToken.create',
                id,
                name: tokenName,
                group: 'color',
                values: { [defaultMode(doc)]: { type: 'color', value: value.trim() } },
              },
            ])
          )
            created(id)
        } catch (error) {
          setValidation((error as Error).message)
        }
      }}
    >
      <h3>
        {token
          ? colorLabel(token.name)
          : family
            ? `New variant of ${colorLabel(family)}`
            : 'New project color'}
      </h3>
      {!token && (
        <label>
          {family ? 'Variant name' : 'Color name'}
          <input
            autoComplete="off"
            value={name}
            disabled={disabled}
            placeholder={family ? 'e.g. Light or Muted' : 'e.g. Brand or Surface'}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      )}
      {token && doc.site.modes.length > 1 && (
        <label>
          Color mode
          <select
            disabled={busy || dirty}
            value={mode}
            onChange={(event) => {
              setMode(event.target.value)
              setValue(colorPreview(doc, selected, event.target.value))
            }}
          >
            {doc.site.modes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="color-value-row">
        <span className="color-swatch large" style={{ background: value }} />
        <label>
          Color value
          <input
            value={value}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <label className="color-picker-label">
          Pick
          <input
            type="color"
            aria-label="Color picker"
            disabled={disabled}
            value={pickerHex(value, '#6952d9')}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
      </div>
      {token && (
        <>
          <p className="hint">
            Updating this color changes every linked style. Variants have their own values.
          </p>
          <details>
            <summary>
              {uses.length} linked style {uses.length === 1 ? 'declaration' : 'declarations'}
            </summary>
            <ul>
              {uses.map((style) => (
                <li key={`${style.class}-${style.breakpoint}-${style.state}-${style.property}`}>
                  {doc.classes[style.class]?.name ?? 'Local style'} · {style.property} ·{' '}
                  {style.breakpoint} / {style.state}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      <ErrorNote message={validation} />
      <div className="row">
        {!token && (
          <button className="primary" type="submit" disabled={busy || conflict || !name.trim()}>
            Create color
          </button>
        )}
        {token && (
          <span className="hint" role="status">
            {conflict
              ? 'Changes paused'
              : !valid
                ? 'Enter a valid color'
                : busy || dirty
                  ? 'Saving…'
                  : 'All changes saved'}
          </span>
        )}
        {autosave.hasFailed && !conflict && (
          <button type="button" onClick={autosave.retry}>
            Retry changes
          </button>
        )}
        {token && (
          <button type="button" disabled={conflict} onClick={variant}>
            Add variant
          </button>
        )}
      </div>
    </form>
  )
}
