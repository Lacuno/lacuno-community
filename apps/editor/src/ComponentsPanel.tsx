import type { Binding, Component, Document } from '@freeflow/schema'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import {
  type ComponentInstance,
  componentNameError,
  componentTextFields,
  componentUsage,
  componentWouldCycle,
  extractComponent,
} from './components.js'
import { EditorIcon } from './EditorIcon.js'
import type { EditOperation } from './history.js'
import { useAutosave } from './useAutosave.js'
import './components.css'

type Save = (operations: EditOperation[]) => Promise<boolean>

export function ComponentsPanel({
  doc,
  editing,
  disabled,
  createReason,
  create,
  insert,
  edit,
}: {
  doc: Document
  editing: string
  disabled: boolean
  createReason: string
  create: () => void
  insert: (id: string) => void
  edit: (id: string) => void
}) {
  return (
    <section className="components-library" aria-label="Components">
      <button
        type="button"
        className="component-create"
        disabled={disabled || !!createReason}
        onClick={create}
      >
        <EditorIcon name="plus" /> Create component…
      </button>
      <p className="hint">
        {createReason || 'Turn the selected element and its contents into a reusable component.'}
      </p>
      <h3>Library</h3>
      {Object.values(doc.components)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((component) => (
          <div className="component-row" key={component.id}>
            <button
              type="button"
              className="component-name"
              disabled={disabled}
              onClick={() => edit(component.id)}
              title={`Edit shared ${component.name}`}
            >
              <EditorIcon name="component" />
              <span>
                {component.name}
                <small>
                  {componentUsage(doc, component.id)}{' '}
                  {componentUsage(doc, component.id) === 1 ? 'instance' : 'instances'}
                </small>
              </span>
            </button>
            <button
              type="button"
              className="component-insert"
              disabled={disabled || componentWouldCycle(doc, component.id, editing)}
              aria-label={`Insert ${component.name}`}
              title={`Insert ${component.name}`}
              onClick={() => insert(component.id)}
            >
              <EditorIcon name="plus" />
            </button>
          </div>
        ))}
      {!Object.keys(doc.components).length && (
        <p className="hint">Your reusable components will appear here.</p>
      )}
    </section>
  )
}

function ComponentDialog({
  title,
  disabled,
  close,
  children,
}: {
  title: string
  disabled: boolean
  close: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
    dialog.current?.querySelector('input')?.focus()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="page-settings-dialog component-dialog"
      aria-label={title}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault()
        if (!disabled) close()
      }}
    >
      <header>
        <h2>{title}</h2>
        <button
          className="component-close"
          type="button"
          aria-label="Close"
          disabled={disabled}
          onClick={close}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  )
}

export function CreateComponentDialog({
  doc,
  selected,
  disabled,
  save,
  created,
  close,
}: {
  doc: Document
  selected: string
  disabled: boolean
  save: Save
  created: (id: string) => void
  close: () => void
}) {
  const [name, setName] = useState(doc.nodes[selected]?.meta?.label ?? '')
  const [exposed, setExposed] = useState<string[]>([])
  const [error, setError] = useState('')
  const fields = componentTextFields(doc, selected)
  return (
    <ComponentDialog title="Create component" disabled={disabled} close={close}>
      <p className="hint">
        Reuse this element on other pages. Shared design changes update every instance.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          try {
            const edit = extractComponent(doc, selected, name, exposed)
            if (await save(edit.operations)) {
              created(edit.instance)
              close()
            } else
              setError(
                'Could not create the component. Your selection is unchanged; check the editor message.',
              )
          } catch (error) {
            setError((error as Error).message)
          }
        }}
      >
        <label>
          Name
          <input
            value={name}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
            placeholder="For example, Site header"
          />
        </label>
        {fields.length > 0 && (
          <details className="component-fields">
            <summary>Allow instance-specific text</summary>
            <p className="hint">
              Checked text can vary per instance. Unchecked text stays shared. Rich-text formatting
              stays in the shared design.
            </p>
            {fields.map((node) => (
              <label className="component-field-choice" key={node.id}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={exposed.includes(node.id)}
                  onChange={(event) =>
                    setExposed(
                      event.target.checked
                        ? [...exposed, node.id]
                        : exposed.filter((id) => id !== node.id),
                    )
                  }
                />
                <span>{node.text.type === 'static' ? String(node.text.value) : ''}</span>
              </label>
            ))}
          </details>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer className="component-dialog-actions">
          <button type="button" disabled={disabled} onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={disabled || !name.trim()}>
            Create component
          </button>
        </footer>
      </form>
    </ComponentDialog>
  )
}

function PropertyFields({
  doc,
  component,
  values,
  disabled,
  change,
}: {
  doc: Document
  component: Component
  values: Record<string, Binding>
  disabled: boolean
  change: (name: string, value: Binding) => void
}) {
  const fieldId = useId()
  return (
    <>
      {component.props.map((prop) => {
        const binding = values[prop.name]
        const value =
          binding?.type === 'static'
            ? binding.value
            : binding?.type === 'asset'
              ? binding.asset
              : prop.default
        const bound = binding && binding.type !== 'static' && binding.type !== 'asset'
        if (prop.type === 'richtext' || bound)
          return (
            <p className="hint" key={prop.name}>
              {prop.label ?? prop.name}: bound content is preserved and read-only here.
            </p>
          )
        return (
          <label key={prop.name} htmlFor={`${fieldId}-${prop.name}`}>
            {prop.label ?? prop.name}
            {prop.type === 'boolean' ? (
              <select
                id={`${fieldId}-${prop.name}`}
                disabled={disabled}
                value={String(value ?? false)}
                onChange={(event) =>
                  change(prop.name, { type: 'static', value: event.target.value === 'true' })
                }
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            ) : prop.type === 'image' ? (
              <select
                id={`${fieldId}-${prop.name}`}
                disabled={disabled}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) =>
                  change(
                    prop.name,
                    event.target.value
                      ? { type: 'asset', asset: event.target.value }
                      : { type: 'static', value: '' },
                  )
                }
              >
                <option value="">No image</option>
                {Object.values(doc.assets).map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name ?? asset.id}
                  </option>
                ))}
              </select>
            ) : prop.type === 'option' ? (
              <select
                id={`${fieldId}-${prop.name}`}
                disabled={disabled}
                value={String(value ?? '')}
                onChange={(event) =>
                  change(prop.name, { type: 'static', value: event.target.value })
                }
              >
                <option value="">Default</option>
                {prop.options?.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                id={`${fieldId}-${prop.name}`}
                disabled={disabled}
                type={prop.type === 'number' ? 'number' : 'text'}
                value={String(value ?? '')}
                onChange={(event) => {
                  if (prop.type !== 'number' || Number.isFinite(event.target.valueAsNumber))
                    change(prop.name, {
                      type: 'static',
                      value:
                        prop.type === 'number' ? event.target.valueAsNumber : event.target.value,
                    })
                }}
              />
            )}
          </label>
        )
      })}
    </>
  )
}

export function ComponentInstancePanel({
  doc,
  node,
  busy,
  conflict,
  save,
  registerFlush,
  dirtyChanged,
  edit,
  detach,
}: {
  doc: Document
  node: ComponentInstance
  busy: boolean
  conflict: boolean
  save: Save
  registerFlush: (flush: () => Promise<boolean>) => void
  dirtyChanged: (dirty: boolean) => void
  edit: () => void
  detach: () => void
}) {
  const component = doc.components[node.component]!
  const usage = componentUsage(doc, component.id)
  const [values, setValues] = useState(node.props ?? {})
  const dirty = JSON.stringify(values) !== JSON.stringify(node.props ?? {})
  let locked = false
  for (
    let current: (typeof doc.nodes)[string] | undefined = node;
    current;
    current = current.parent ? doc.nodes[current.parent] : undefined
  ) {
    if (current.meta?.locked) locked = true
  }
  const autosave = useAutosave(
    dirty
      ? [{ type: 'node.update', id: node.id, props: Object.keys(values).length ? values : null }]
      : [],
    !conflict && !locked,
    busy,
    save,
  )
  const flush = useRef(autosave.flush)
  flush.current = autosave.flush
  useEffect(() => {
    registerFlush(() => flush.current())
    return () => registerFlush(async () => true)
  }, [registerFlush])
  useEffect(() => {
    dirtyChanged(dirty)
  }, [dirty, dirtyChanged])
  return (
    <aside className="inspector component-inspector">
      <div className="selection-heading">
        <EditorIcon name="component" />
        <strong>{component.name}</strong>
        <span className="badge">Instance</span>
      </div>
      <section>
        <h3>This instance only</h3>
        <p className="hint">Content here does not change other instances.</p>
        <PropertyFields
          doc={doc}
          component={component}
          values={values}
          disabled={conflict || locked}
          change={(name, value) => setValues({ ...values, [name]: value })}
        />
        {!component.props.length && (
          <p className="hint">This component has no exposed content fields.</p>
        )}
        {!!Object.keys(values).length && (
          <button
            type="button"
            className="component-text-action"
            disabled={busy || conflict || locked}
            onClick={() => setValues({})}
          >
            Reset instance content
          </button>
        )}
        {autosave.hasFailed && (
          <button type="button" onClick={autosave.retry}>
            Retry content save
          </button>
        )}
      </section>
      <section>
        <h3>Shared design</h3>
        <p className="hint">
          Used by {usage} {usage === 1 ? 'instance' : 'instances'}. Design changes affect every
          instance.
        </p>
        <button type="button" disabled={busy || dirty || conflict || locked} onClick={edit}>
          <EditorIcon name="component" /> Edit shared component
        </button>
      </section>
      <details className="component-secondary">
        <summary>Instance actions</summary>
        <button type="button" disabled={busy || dirty || conflict || locked} onClick={detach}>
          Detach from component…
        </button>
      </details>
    </aside>
  )
}

export function ComponentSettingsDialog({
  doc,
  component,
  disabled,
  save,
  close,
}: {
  doc: Document
  component: Component
  disabled: boolean
  save: Save
  close: () => void
}) {
  const [name, setName] = useState(component.name)
  const [defaults, setDefaults] = useState<Record<string, Binding>>({})
  const [error, setError] = useState('')
  const editable = {
    ...component,
    props: component.props.filter((prop) =>
      ['string', 'number', 'boolean', 'option', 'link'].includes(prop.type),
    ),
  }
  return (
    <ComponentDialog title="Component settings" disabled={disabled} close={close}>
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          const issue = componentNameError(doc, name, component.id)
          if (issue) {
            setError(issue)
            return
          }
          const props = component.props.map((prop) =>
            defaults[prop.name]?.type === 'static'
              ? {
                  ...prop,
                  default: (defaults[prop.name] as Extract<Binding, { type: 'static' }>).value,
                }
              : prop,
          )
          if (
            await save([{ type: 'component.update', id: component.id, name: name.trim(), props }])
          )
            close()
          else setError('Could not save component settings. Check the editor message.')
        }}
      >
        <label>
          Name
          <input
            disabled={disabled}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <h3>Default content</h3>
        <p className="hint">Defaults affect instances without their own content overrides.</p>
        <PropertyFields
          doc={doc}
          component={editable}
          values={defaults}
          disabled={disabled}
          change={(name, value) => setDefaults({ ...defaults, [name]: value })}
        />
        {!editable.props.length && (
          <p className="hint">No editable defaults. Edit shared text on the canvas.</p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <footer className="component-dialog-actions">
          <button type="button" disabled={disabled} onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={disabled}>
            Save component settings
          </button>
        </footer>
      </form>
    </ComponentDialog>
  )
}

export function DetachComponentDialog({
  name,
  disabled,
  close,
  confirm,
}: {
  name: string
  disabled: boolean
  close: () => void
  confirm: () => Promise<boolean>
}) {
  const [error, setError] = useState('')
  return (
    <ComponentDialog title="Detach component" disabled={disabled} close={close}>
      <p>
        Detach “{name}” into independent elements? Its current content and appearance are kept, but
        it will stop receiving shared updates. Nested components remain linked.
      </p>
      <p className="hint">You can undo this change.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <footer className="component-dialog-actions">
        <button type="button" disabled={disabled} onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          disabled={disabled}
          className="primary"
          onClick={async () => {
            if (await confirm()) close()
            else setError('Could not detach this instance. Check the editor message.')
          }}
        >
          Detach component
        </button>
      </footer>
    </ComponentDialog>
  )
}
