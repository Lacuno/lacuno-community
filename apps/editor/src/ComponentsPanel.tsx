import type { Operation } from '@lacuno/document'
import type { Binding, Component, ComponentInstanceNode, Document, State } from '@lacuno/schema'
import { useEffect, useId, useRef, useState } from 'react'
import type { StyleEdit } from './colorWheel.js'
import {
  componentDeletionReason,
  componentNameError,
  componentTextFields,
  componentUsage,
  componentWouldCycle,
  duplicateComponent,
  extractComponent,
  fieldName,
  fieldRemovalReason,
  updateComponentFields,
} from './components.js'
import { Dialog, ErrorNote } from './Dialog.js'
import { EditorIcon } from './EditorIcon.js'
import { formattingOperations } from './formatting.js'
import { isLocked } from './structure.js'
import { useAutosave } from './useAutosave.js'
import './components.css'

type Save = (operations: Operation[]) => Promise<boolean>

const componentDialog = {
  className: 'page-settings-dialog component-dialog',
  closeLabel: '×',
  closeName: 'Close',
  closeClassName: 'component-close',
}

export function ComponentsPanel({
  doc,
  editing,
  disabled,
  createReason,
  create,
  insert,
  edit,
  save,
}: {
  doc: Document
  editing: string
  disabled: boolean
  createReason: string
  create: () => void
  insert: (id: string) => void
  edit: (id: string) => void
  save: Save
}) {
  const [actions, setActions] = useState('')
  return (
    <section className="components-library" aria-label="Components">
      {doc.components[actions] && (
        <ComponentActionsDialog
          key={actions}
          doc={doc}
          component={doc.components[actions]!}
          disabled={disabled}
          save={save}
          close={() => setActions('')}
        />
      )}
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
            <button
              type="button"
              className="component-actions"
              aria-label={`Actions for ${component.name}`}
              title={`Actions for ${component.name}`}
              aria-haspopup="dialog"
              disabled={disabled}
              onClick={() => setActions(component.id)}
            >
              ⋯
            </button>
          </div>
        ))}
      {!Object.keys(doc.components).length && (
        <p className="hint">Your reusable components will appear here.</p>
      )}
    </section>
  )
}

function ComponentActionsDialog({
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
  const [name, setName] = useState(() => {
    let name = `${component.name} copy`
    for (let index = 2; componentNameError(doc, name); index++)
      name = `${component.name} copy ${index}`
    return name
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const reason = componentDeletionReason(doc, component.id)
  const run = async (operations: Operation[]) => {
    if (await save(operations)) close()
    else setError('Could not save component changes. Check the editor message and try again.')
  }
  return (
    <Dialog
      {...componentDialog}
      title={`Manage ${component.name}`}
      disabled={disabled}
      close={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          try {
            void run(duplicateComponent(doc, component.id, name))
          } catch (error) {
            setError((error as Error).message)
          }
        }}
      >
        <h3>Duplicate component</h3>
        <p className="hint">
          Create an independent definition with copied local styles. Shared classes and nested
          components stay linked. Existing instances are unchanged.
        </p>
        <label>
          Copy name
          <input
            value={name}
            disabled={disabled}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <button type="submit" disabled={disabled || !name.trim()}>
          Duplicate component
        </button>
        <details className="component-secondary">
          <summary>Delete component</summary>
          {reason ? (
            <p className="hint">{reason}</p>
          ) : (
            <>
              <p className="hint">
                This component is unused. Deleting it removes its definition from the library. You
                can undo this during this session.
              </p>
              {confirmDelete ? (
                <div role="alert">
                  <p>Delete “{component.name}”?</p>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void run([{ type: 'component.delete', id: component.id }])}
                  >
                    Confirm delete component
                  </button>
                  <button type="button" disabled={disabled} onClick={() => setConfirmDelete(false)}>
                    Keep component
                  </button>
                </div>
              ) : (
                <button type="button" disabled={disabled} onClick={() => setConfirmDelete(true)}>
                  Delete component…
                </button>
              )}
            </>
          )}
        </details>
        <ErrorNote message={error} />
        <footer className="component-dialog-actions">
          <button type="button" disabled={disabled} onClick={close}>
            Close
          </button>
        </footer>
      </form>
    </Dialog>
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
    <Dialog {...componentDialog} title="Create component" disabled={disabled} close={close}>
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
                <span>{node.text.value}</span>
              </label>
            ))}
          </details>
        )}
        <ErrorNote message={error} />
        <footer className="component-dialog-actions">
          <button type="button" disabled={disabled} onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={disabled || !name.trim()}>
            Create component
          </button>
        </footer>
      </form>
    </Dialog>
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
  breakpoint,
  state,
  busy,
  conflict,
  save,
  registerFlush,
  dirtyChanged,
  edit,
  detach,
}: {
  doc: Document
  node: ComponentInstanceNode
  breakpoint: string
  state: State
  busy: boolean
  conflict: boolean
  save: Save
  registerFlush: (flush: () => Promise<boolean>) => () => void
  dirtyChanged: (dirty: boolean) => void
  edit: () => void
  detach: () => void
}) {
  const component = doc.components[node.component]!
  const usage = componentUsage(doc, component.id)
  const [values, setValues] = useState(node.props ?? {})
  const dirty = JSON.stringify(values) !== JSON.stringify(node.props ?? {})
  const locked = isLocked(doc, node.id)
  const autosave = useAutosave(
    dirty
      ? [{ type: 'node.update', id: node.id, props: Object.keys(values).length ? values : null }]
      : [],
    !conflict && !locked,
    busy,
    save,
    { dirty, dirtyChanged, registerFlush },
  )
  // An instance has a box of its own, so the canvas bar, its handles and the nudge write its
  // local class as the Inspector would; a drag phase waits for the commit instead of previewing.
  const classId = useRef(`c-${crypto.randomUUID()}`)
  const canvasStyle = useRef((_: StyleEdit & { id: string }) => {})
  canvasStyle.current = (edit) => {
    if (edit.id !== node.id || conflict || locked || !('phase' in edit) || edit.phase !== 'commit')
      return
    const changes = 'changes' in edit ? edit.changes : { [edit.property]: edit.value }
    void save(formattingOperations(doc, node, changes, () => classId.current, breakpoint, state))
  }
  useEffect(() => {
    const listen = (event: Event) => canvasStyle.current((event as CustomEvent).detail)
    window.addEventListener('lacuno:canvas-style', listen)
    return () => window.removeEventListener('lacuno:canvas-style', listen)
  }, [])
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
  const [fields, setFields] = useState(component.props)
  const [exposed, setExposed] = useState<Record<string, string>>({})
  const [textToExpose, setTextToExpose] = useState('')
  const [defaults, setDefaults] = useState<Record<string, Binding>>({})
  const [error, setError] = useState('')
  const editable = {
    ...component,
    props: fields.filter((prop) =>
      ['string', 'number', 'boolean', 'option', 'link'].includes(prop.type),
    ),
  }
  return (
    <Dialog {...componentDialog} title="Component settings" disabled={disabled} close={close}>
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          const issue = componentNameError(doc, name, component.id)
          if (issue) {
            setError(issue)
            return
          }
          const props = fields.map((prop) =>
            defaults[prop.name]?.type === 'static'
              ? {
                  ...prop,
                  default: (defaults[prop.name] as Extract<Binding, { type: 'static' }>).value,
                }
              : prop,
          )
          try {
            if (await save(updateComponentFields(doc, component, name, props, exposed))) close()
            else setError('Could not save component settings. Check the editor message.')
          } catch (error) {
            setError((error as Error).message)
          }
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
        <h3>Editable fields</h3>
        <p className="hint">
          Rename fields without changing instance content. Removing a field makes its default text
          shared again; custom instance content must be reset first.
        </p>
        {fields.map((prop) => {
          const existing = component.props.some((field) => field.name === prop.name)
          const reason = existing ? fieldRemovalReason(doc, component, prop.name) : ''
          return (
            <div className="component-field-settings" key={prop.name}>
              <label>
                Field name
                <input
                  aria-label={`Field name for ${prop.name}`}
                  value={prop.label ?? prop.name}
                  disabled={disabled}
                  onChange={(event) =>
                    setFields(
                      fields.map((field) =>
                        field.name === prop.name ? { ...field, label: event.target.value } : field,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                disabled={disabled || !!reason}
                title={reason || 'Make this text shared again'}
                aria-label={`Remove field ${prop.label ?? prop.name}`}
                onClick={() => {
                  setFields(fields.filter((field) => field.name !== prop.name))
                  setExposed(
                    Object.fromEntries(
                      Object.entries(exposed).filter(([, name]) => name !== prop.name),
                    ),
                  )
                }}
              >
                Remove
              </button>
              {reason && <p className="hint">{reason}</p>}
            </div>
          )
        })}
        <p className="hint">
          Only shared plain text can be exposed here. Rich text stays in the shared design.
        </p>
        <label>
          Text to expose
          <select
            value={textToExpose}
            disabled={disabled}
            onChange={(event) => setTextToExpose(event.target.value)}
          >
            <option value="">Select shared text…</option>
            {componentTextFields(doc, component.root)
              .filter((node) => !exposed[node.id])
              .map((node) => (
                <option key={node.id} value={node.id}>
                  {node.text.value}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || !textToExpose}
          onClick={() => {
            const node = componentTextFields(doc, component.root).find(
              (node) => node.id === textToExpose,
            )
            if (!node) return
            const field = fieldName(fields)
            setFields([
              ...fields,
              {
                name: field,
                type: 'string',
                label: node.meta?.label ?? node.text.value.slice(0, 48),
                default: node.text.value,
              },
            ])
            setExposed({ ...exposed, [node.id]: field })
            setTextToExpose('')
          }}
        >
          <EditorIcon name="plus" /> Add text field
        </button>
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
        <ErrorNote message={error} />
        <footer className="component-dialog-actions">
          <button type="button" disabled={disabled} onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={disabled}>
            Save component settings
          </button>
        </footer>
      </form>
    </Dialog>
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
    <Dialog {...componentDialog} title="Detach component" disabled={disabled} close={close}>
      <p>
        Detach “{name}” into independent elements? Its current content and appearance are kept, but
        it will stop receiving shared updates. Nested components remain linked.
      </p>
      <p className="hint">You can undo this change.</p>
      <ErrorNote message={error} />
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
    </Dialog>
  )
}
