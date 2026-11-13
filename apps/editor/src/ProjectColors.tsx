import { contextFromDocument, serializeValue } from '@lacuno/css'
import type { Operation } from '@lacuno/document'
import { referencesToDesignToken } from '@lacuno/document/references'
import { type Document, designTokenCssName } from '@lacuno/schema'
import { useEffect, useRef, useState } from 'react'
import type { LivePreview } from './Canvas.js'
import {
  applyTheme,
  colorLabel,
  colorPreview,
  colorToken,
  defaultMode,
  deleteTheme,
  pickerHex,
  projectColors,
  themeColors,
  themes,
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

/** What both token forms get from the dialog. */
type FormProps = {
  doc: Document
  busy: boolean
  conflict: boolean
  dirtyChanged: (dirty: boolean) => void
  save: (ops: Operation[]) => Promise<boolean>
  autoSave: (ops: Operation[]) => Promise<boolean>
  previewChanged: (preview: LivePreview) => void
  registerFlush: (flush: () => Promise<boolean>) => () => void
}

export function ProjectColors({
  error,
  close,
  leave,
  ...form
}: FormProps & {
  error: string
  close: () => void
  leave: (action: () => void) => Promise<void>
}) {
  const { doc, busy, conflict } = form
  // The theme whose colours show and change: the person's view, like the breakpoint.
  const [theme, setTheme] = useState('')
  const mode = themes(doc).some((item) => item.id === theme) ? theme : defaultMode(doc)
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
      {group === 'color' && (
        <Themes
          doc={doc}
          mode={mode}
          disabled={busy || conflict}
          choose={(id) => switchTo(() => setTheme(id))}
          save={form.save}
        />
      )}
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
                  style={{ background: colorPreview(doc, token.id, mode) }}
                />
                <span>{colorLabel(token.name)}</span>
              </button>
            ))}
          </nav>
          <ColorForm
            key={`${selected}-${family}-${mode}-${reset}`}
            {...form}
            mode={mode}
            remount={() => setReset((value) => value + 1)}
            selected={selected}
            family={family}
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
            {...form}
            group={group}
            selected={selected}
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

/**
 * Autosaves a saved token's edits unless a problem holds them, and previews them on the canvas. Its
 * status reads how saving goes or the problem, with Retry after a failed save.
 */
function useTokenSave(
  { busy, conflict, dirtyChanged, autoSave, previewChanged, registerFlush }: FormProps,
  operations: Operation[],
  saved: boolean,
  dirty: boolean,
  problem: string,
  preview: LivePreview,
) {
  const autosave = useAutosave(operations, saved && !problem && !conflict, busy, autoSave, {
    dirty,
    dirtyChanged,
    registerFlush,
  })
  const previewKey = JSON.stringify(preview)
  useEffect(() => {
    previewChanged(JSON.parse(previewKey))
    return () => previewChanged({})
  }, [previewKey, previewChanged])
  const status = saved && (
    <>
      <span className="hint" role="status">
        {conflict ? 'Changes paused' : problem || (busy || dirty ? 'Saving…' : 'All changes saved')}
      </span>
      {autosave.hasFailed && !conflict && (
        <button type="button" onClick={autosave.retry}>
          Retry changes
        </button>
      )}
    </>
  )
  return { flush: autosave.flush, status }
}

/**
 * The theme switch above the colours: a chip per theme with its colours, the site's own first, and
 * for the chosen theme its name, its use as the site's colours and its removal.
 */
function Themes({
  doc,
  mode,
  disabled,
  choose,
  save,
}: {
  doc: Document
  mode: string
  disabled: boolean
  choose: (id: string) => void
  save: (ops: Operation[]) => Promise<boolean>
}) {
  const original = defaultMode(doc)
  const chosen = mode === original ? undefined : doc.site.modes.find((item) => item.id === mode)
  // The name being typed: of a new theme, or of the chosen one.
  const [naming, setNaming] = useState<'' | 'new' | 'rename'>('')
  const [name, setName] = useState('')
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (naming) field.current?.select()
  }, [naming])
  const start = (kind: 'new' | 'rename') => {
    setName(kind === 'rename' ? chosen!.label : '')
    setNaming(kind)
  }
  const chip = (id: string, label: string) => (
    <button
      type="button"
      className="theme-chip"
      key={id}
      aria-pressed={mode === id}
      disabled={disabled}
      onClick={() => choose(id)}
    >
      <span className="theme-dots" aria-hidden="true">
        {projectColors(doc)
          .slice(0, 4)
          .map((token) => (
            <span key={token.id} style={{ background: colorPreview(doc, token.id, id) }} />
          ))}
      </span>
      {label}
    </button>
  )
  if (naming)
    return (
      <form
        className="themes-bar"
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          // Escape leaves the name, not the dialog.
          event.preventDefault()
          setNaming('')
        }}
        onSubmit={async (event) => {
          event.preventDefault()
          const label = name.trim()
          if (!label || disabled) return
          const id = `mode-${crypto.randomUUID()}`
          const saved = await save([
            naming === 'new'
              ? { type: 'mode.create', id, label }
              : { type: 'mode.update', id: mode, label },
          ])
          if (!saved) return
          if (naming === 'new') choose(id)
          setNaming('')
        }}
      >
        <input
          ref={field}
          aria-label="Theme name"
          autoComplete="off"
          maxLength={60}
          value={name}
          disabled={disabled}
          placeholder="Theme name, e.g. Sage"
          onChange={(event) => setName(event.target.value)}
        />
        <button className="primary" type="submit" disabled={disabled || !name.trim()}>
          {naming === 'new' ? 'Create theme' : 'Rename theme'}
        </button>
        <button type="button" className="quiet" onClick={() => setNaming('')}>
          Cancel
        </button>
      </form>
    )
  return (
    <div className="themes-bar">
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset would bring its own box and legend. */}
      <div className="theme-chips" role="group" aria-label="Theme">
        {chip(original, 'Original')}
        {themes(doc).map((item) => chip(item.id, item.label))}
        <button
          type="button"
          className="theme-chip new"
          disabled={disabled}
          onClick={() => start('new')}
        >
          New theme
        </button>
      </div>
      {chosen && (
        <div className="theme-actions">
          <button
            type="button"
            className="quiet"
            disabled={disabled}
            onClick={() => start('rename')}
          >
            Rename
          </button>
          <button
            type="button"
            className="quiet"
            disabled={disabled || !applyTheme(doc, mode).length}
            onClick={() => void save(applyTheme(doc, mode))}
          >
            Use as the site’s colors
          </button>
          <button
            type="button"
            className="quiet danger"
            disabled={disabled}
            onClick={async () => {
              if (await save(deleteTheme(doc, mode))) choose(original)
            }}
          >
            Delete theme
          </button>
        </div>
      )}
    </div>
  )
}

function ColorForm({
  selected,
  family,
  mode,
  remount,
  created,
  variant,
  ...form
}: FormProps & {
  /** The mode whose values show and change: the default, or the chosen theme. */
  mode: string
  /** Starts the form again from the saved colour. */
  remount: () => void
  selected: string
  family: string
  created: (id: string) => void
  variant: () => void
}) {
  const { doc, busy, conflict, save, autoSave } = form
  const token = doc.designTokens[selected]
  const [name, setName] = useState('')
  const themed = mode !== defaultMode(doc)
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
  const { flush, status } = useTokenSave(
    form,
    operations,
    !!token,
    dirty,
    valid ? '' : 'Enter a valid color',
    // The canvas shows the chosen theme, with the colour being changed on top.
    {
      colors: {
        ...themeColors(doc, mode),
        ...(token && valid ? { [designTokenCssName(token.name)]: value } : {}),
      },
    },
  )
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
          await flush()
          return
        }
        try {
          const create = colorToken(doc, name, value.trim(), family || undefined)
          if (await save([create])) created(create.id)
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
          <>
            {status}
            {themed &&
              (token.values[mode] ? (
                <button
                  type="button"
                  disabled={busy || conflict || dirty}
                  onClick={async () => {
                    if (await autoSave([{ type: 'designToken.clearValue', id: token.id, mode }]))
                      remount()
                  }}
                >
                  Reset to original
                </button>
              ) : (
                <span className="hint">Same as the original</span>
              ))}
            <button type="button" disabled={conflict} onClick={variant}>
              Add variant
            </button>
          </>
        )}
      </div>
    </form>
  )
}

function TokenForm({
  group,
  selected,
  selectToken,
  ...form
}: FormProps & {
  group: TokenGroup
  selected: string
  selectToken: (id: string) => void
}) {
  const { doc, busy, conflict, save, autoSave } = form
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
  const { flush, status } = useTokenSave(
    form,
    operations,
    !!token,
    dirty,
    nameProblem || problem || '',
    token && !problem
      ? {
          colors: {
            [designTokenCssName(token.name)]: serializeValue(tokenCssValue(value), context),
          },
        }
      : {},
  )
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
          await flush()
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
        {group === 'shadow' && (
          <span className="token-shadow-preview" style={{ boxShadow: problem ? '' : value }} />
        )}
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
        {status}
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
