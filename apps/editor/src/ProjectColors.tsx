import { type Document, designTokenCssName } from '@freeflow/schema'
import { useEffect, useRef, useState } from 'react'
import {
  colorLabel,
  colorPreview,
  colorTokenName,
  defaultMode,
  projectColors,
  referencesColor,
} from './colors.js'
import type { EditOperation } from './history.js'
import type { LivePreview } from './livePreview.js'
import { useAutosave } from './useAutosave.js'

export function ProjectColors({
  doc,
  busy,
  conflict,
  error,
  dirtyChanged,
  save,
  close,
  autoSave,
  previewChanged,
}: {
  doc: Document
  busy: boolean
  conflict: boolean
  error: string
  dirtyChanged: (value: boolean) => void
  save: (ops: EditOperation[]) => Promise<boolean>
  close: () => void
  autoSave: (ops: EditOperation[]) => Promise<boolean>
  previewChanged: (preview: LivePreview) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [selected, setSelected] = useState('')
  const [family, setFamily] = useState('')
  const [dirty, setDirty] = useState(false)
  const [reset, setReset] = useState(0)
  const pendingFlush = useRef<() => Promise<boolean>>(async () => true)
  const registerFlush = useRef((flush: () => Promise<boolean>) => {
    pendingFlush.current = flush
  }).current
  useEffect(() => {
    dialog.current?.showModal()
  }, [])
  useEffect(() => {
    dirtyChanged(dirty)
  }, [dirty, dirtyChanged])
  const leave = async (action: () => void) => {
    if (
      (dirty || busy) &&
      !(await pendingFlush.current()) &&
      !window.confirm('Discard your unsaved color changes?')
    )
      return
    setDirty(false)
    dirtyChanged(false)
    setReset((value) => value + 1)
    action()
  }
  return (
    <dialog
      ref={dialog}
      className="colors-dialog"
      aria-labelledby="colors-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) leave(close)
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header>
        <div>
          <h2 id="colors-title">Project colors</h2>
          <p>Reusable colors for your entire site.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => leave(close)}>
          Close colors
        </button>
      </header>
      <div className="colors-layout">
        <nav aria-label="Project palette">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              leave(() => {
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
                leave(() => {
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
          dirtyChanged={setDirty}
          save={save}
          autoSave={autoSave}
          previewChanged={previewChanged}
          registerFlush={registerFlush}
          created={(id) => {
            setDirty(false)
            dirtyChanged(false)
            setSelected(id)
            setFamily('')
          }}
          variant={() =>
            leave(() => {
              setFamily(doc.designTokens[selected]!.name)
              setSelected('')
            })
          }
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {conflict && (
        <p className="note">Close colors, then reload the latest site before continuing.</p>
      )}
    </dialog>
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
  save: (ops: EditOperation[]) => Promise<boolean>
  created: (id: string) => void
  variant: () => void
  autoSave: (ops: EditOperation[]) => Promise<boolean>
  previewChanged: (preview: LivePreview) => void
  registerFlush: (flush: () => Promise<boolean>) => void
}) {
  const token = doc.designTokens[selected]
  const [name, setName] = useState('')
  const [mode, setMode] = useState(defaultMode(doc))
  const original = token ? colorPreview(doc, selected, mode) : '#6952d9'
  const [value, setValue] = useState(original)
  const [validation, setValidation] = useState('')
  const dirty = name !== '' || value !== original
  useEffect(() => {
    dirtyChanged(dirty)
  }, [dirty, dirtyChanged])
  const valid =
    CSS.supports('color', value.trim()) &&
    !/var\(|currentcolor|inherit|initial|unset|revert/i.test(value)
  const operations: EditOperation[] =
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
  const autosave = useAutosave(operations, !!token && valid && !conflict, busy, autoSave)
  const flushRef = useRef<() => Promise<boolean>>(async () => true)
  flushRef.current = async () =>
    !dirty || (!!token && valid && !conflict && (await autosave.flush()))
  useEffect(() => {
    registerFlush(() => flushRef.current())
    return () => registerFlush(async () => true)
  }, [registerFlush])
  const previewKey = JSON.stringify(
    token && valid ? { colors: { [designTokenCssName(token.name)]: value } } : {},
  )
  useEffect(() => {
    previewChanged(JSON.parse(previewKey))
    return () => previewChanged({})
  }, [previewKey, previewChanged])
  const uses = token
    ? Object.values(doc.styles).filter((style) => referencesColor(style.value, token.id))
    : []
  return (
    <form
      className="color-form"
      onSubmit={async (event) => {
        event.preventDefault()
        setValidation('')
        if (busy || conflict) return
        const color = value.trim()
        if (
          !CSS.supports('color', color) ||
          /var\(|currentcolor|inherit|initial|unset|revert/i.test(color)
        ) {
          setValidation('Enter a color such as #6952d9, rgb(105 82 217), or rebeccapurple.')
          return
        }
        try {
          if (token) {
            await autosave.flush()
          } else {
            const id = `dt-${crypto.randomUUID()}`
            const tokenName = colorTokenName(doc, name, family || undefined)
            if (
              await save([
                {
                  type: 'designToken.create',
                  id,
                  name: tokenName,
                  group: 'color',
                  values: { [defaultMode(doc)]: { type: 'color', value: color } },
                },
              ])
            )
              created(id)
          }
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
            disabled={conflict || (busy && !token)}
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
            disabled={conflict || (busy && !token)}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <label className="color-picker-label">
          Pick
          <input
            type="color"
            aria-label="Color picker"
            disabled={conflict || (busy && !token)}
            value={/^#[a-f0-9]{6}$/i.test(value) ? value : '#6952d9'}
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
      {validation && (
        <p className="error" role="alert">
          {validation}
        </p>
      )}
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
          <button type="button" disabled={conflict || (busy && !token)} onClick={variant}>
            Add variant
          </button>
        )}
      </div>
    </form>
  )
}
