import { contextFromDocument, serializeValue } from '@freeflow/css'
import type { Operation } from '@freeflow/document'
import { referencesToDesignToken } from '@freeflow/document/references'
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
import {
  type TokenGroup,
  tokenCssValue,
  tokenGroups,
  tokenLabel,
  tokenName,
  tokensOfGroup,
  tokenValue,
} from './tokens.js'
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
  const [group, setGroup] = useState<'color' | TokenGroup>('color')
  const groups = ['color', ...(Object.keys(tokenGroups) as TokenGroup[])] as const
  const context = contextFromDocument(doc)
  return (
    <Dialog
      title="Design tokens"
      description="Reusable colors, spacing, sizes, type, radii and shadows for your entire site."
      className="colors-dialog"
      closeLabel="Close tokens"
      disabled={busy}
      close={() => switchTo(close)}
    >
      <nav aria-label="Token groups" className="token-groups">
        {groups.map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={group === item}
            disabled={busy}
            onClick={() =>
              switchTo(() => {
                setGroup(item)
                setSelected('')
                setFamily('')
              })
            }
          >
            {item === 'color' ? 'Colors' : tokenGroups[item].label}
          </button>
        ))}
      </nav>
      {group === 'color' ? (
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
                <span
                  className="color-swatch"
                  style={{ background: colorPreview(doc, token.id) }}
                />
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
      ) : (
        <div className="colors-layout">
          <nav aria-label={`${tokenGroups[group].label} tokens`}>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => switchTo(() => setSelected(''))}
            >
              New token
            </button>
            {tokensOfGroup(doc, group).map((token) => {
              const uses = referencesToDesignToken(doc, token.id).length
              return (
                <button
                  type="button"
                  className={`palette-item token-row ${selected === token.id ? 'active' : ''}`}
                  key={token.id}
                  disabled={busy}
                  onClick={() => switchTo(() => setSelected(token.id))}
                >
                  <strong>{tokenLabel(token.name)}</strong>
                  <span>{serializeValue(tokenValue(doc, token), context)}</span>
                  {token.description && <small>{token.description}</small>}
                  <small>
                    Used in {uses} {uses === 1 ? 'style' : 'styles'}
                  </small>
                </button>
              )
            })}
          </nav>
          <TokenForm
            key={`${group}-${selected}-${reset}`}
            doc={doc}
            group={group}
            selected={selected}
            busy={busy}
            conflict={conflict}
            dirtyChanged={dirtyChanged}
            save={save}
            autoSave={autoSave}
            previewChanged={previewChanged}
            registerFlush={registerFlush}
            selectToken={setSelected}
          />
        </div>
      )}
      <ErrorNote message={error} />
      {conflict && (
        <p className="note">Close tokens, then reload the latest site before continuing.</p>
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

function TokenForm({
  doc,
  group,
  selected,
  busy,
  conflict,
  dirtyChanged,
  save,
  autoSave,
  previewChanged,
  registerFlush,
  selectToken,
}: {
  doc: Document
  group: TokenGroup
  selected: string
  busy: boolean
  conflict: boolean
  dirtyChanged: (dirty: boolean) => void
  save: (ops: Operation[]) => Promise<boolean>
  autoSave: (ops: Operation[]) => Promise<boolean>
  previewChanged: (preview: LivePreview) => void
  registerFlush: (flush: () => Promise<boolean>) => () => void
  selectToken: (id: string) => void
}) {
  const token = doc.designTokens[selected]
  const { label, prefix, example, validate } = tokenGroups[group]
  const context = contextFromDocument(doc)
  const [name, setName] = useState(token ? tokenLabel(token.name) : '')
  const [value, setValue] = useState(token ? serializeValue(tokenValue(doc, token), context) : '')
  const [description, setDescription] = useState(token?.description ?? '')
  const [validation, setValidation] = useState('')
  const problem = validate(value)
  let fullName = ''
  let nameProblem = ''
  try {
    fullName = tokenName(doc, group, name, token?.id)
  } catch (error) {
    nameProblem = (error as Error).message
  }
  const valueChanged =
    !!token && JSON.stringify(tokenCssValue(value)) !== JSON.stringify(tokenValue(doc, token))
  const nameChanged = !!token && fullName !== token.name
  const descriptionChanged = description !== (token?.description ?? '')
  const dirty = token
    ? valueChanged || nameChanged || descriptionChanged
    : !!(name || value || description)
  const valid = !problem && !nameProblem
  const operations: Operation[] =
    token && valid
      ? [
          ...(valueChanged
            ? [
                {
                  type: 'designToken.setValue' as const,
                  id: token.id,
                  mode: defaultMode(doc),
                  value: tokenCssValue(value),
                },
              ]
            : []),
          ...(nameChanged || descriptionChanged
            ? [
                {
                  type: 'designToken.update' as const,
                  id: token.id,
                  ...(nameChanged ? { name: fullName } : {}),
                  ...(descriptionChanged ? { description: description || null } : {}),
                },
              ]
            : []),
        ]
      : []
  const autosave = useAutosave(operations, !!token && valid && !conflict, busy, autoSave, {
    dirty,
    dirtyChanged,
    registerFlush,
  })
  const previewKey = JSON.stringify(
    token && !problem
      ? {
          colors: {
            [designTokenCssName(token.name)]: serializeValue(tokenCssValue(value), context),
          },
        }
      : {},
  )
  useEffect(() => {
    previewChanged(JSON.parse(previewKey))
    return () => previewChanged({})
  }, [previewKey, previewChanged])
  const uses = token ? referencesToDesignToken(doc, token.id).length : 0
  const disabled = conflict || (busy && !token)
  return (
    <form
      className="color-form"
      onSubmit={async (event) => {
        event.preventDefault()
        setValidation('')
        if (busy || conflict) return
        if (token) {
          await autosave.flush()
          return
        }
        if (nameProblem || problem) {
          setValidation(nameProblem || problem!)
          return
        }
        const id = `dt-${crypto.randomUUID()}`
        if (
          await save([
            {
              type: 'designToken.create',
              id,
              name: fullName,
              group,
              values: { [defaultMode(doc)]: tokenCssValue(value) },
              ...(description ? { description } : {}),
            },
          ])
        )
          selectToken(id)
      }}
    >
      <h3>{token ? token.name : `New ${label.toLowerCase()} token`}</h3>
      <label>
        Token name
        <span className="token-name">
          <span>{prefix}.</span>
          <input
            aria-label="Token name"
            autoComplete="off"
            value={name}
            disabled={disabled}
            placeholder="e.g. card"
            onChange={(event) => setName(event.target.value)}
          />
        </span>
      </label>
      <div className="color-value-row">
        {group === 'shadow' && (
          <span className="token-shadow-preview" style={{ boxShadow: problem ? '' : value }} />
        )}
        <label>
          Token value
          <input
            autoComplete="off"
            value={value}
            disabled={disabled}
            placeholder={`e.g. ${example}`}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
      </div>
      <label>
        Description
        <input
          autoComplete="off"
          value={description}
          disabled={disabled}
          placeholder="Optional"
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {token && (
        <p className="hint">
          Updating this token changes every linked style. Used in {uses}{' '}
          {uses === 1 ? 'style' : 'styles'}.
        </p>
      )}
      <ErrorNote message={validation} />
      <div className="row">
        {!token && (
          <button className="primary" type="submit" disabled={busy || conflict || !name.trim()}>
            Create token
          </button>
        )}
        {token && (
          <span className="hint" role="status">
            {conflict
              ? 'Changes paused'
              : !valid
                ? nameProblem || problem
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
          <button
            type="button"
            disabled={busy || conflict || dirty || uses > 0}
            title={uses ? `Used in ${uses} ${uses === 1 ? 'style' : 'styles'}` : undefined}
            onClick={async () => {
              if (await autoSave([{ type: 'designToken.delete', id: token.id }])) selectToken('')
            }}
          >
            Delete token
          </button>
        )}
      </div>
    </form>
  )
}
