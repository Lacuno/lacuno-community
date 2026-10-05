import type { Operation } from '@lacuno/document'
import type { Document } from '@lacuno/schema'
import { useState } from 'react'
import { listInsertion } from './binding.js'
import { EditorIcon } from './EditorIcon.js'
import {
  actions,
  dropEdit,
  dropTarget,
  formFields,
  insertionTarget,
  type NodeAction,
  nodeLabel,
  type Placement,
  type Preset,
  siblingMove,
  structures,
  subtreeRestriction,
  type Wrapper,
  wrappers,
  wrapSelection,
  wrapTarget,
} from './structure.js'

const tileLabels: Partial<Record<Preset, string>> = {
  'text-field': 'Text field',
  'email-field': 'Email field',
  'textarea-field': 'Text area',
  'checkbox-field': 'Checkbox',
  'dropdown-field': 'Dropdown',
  submit: 'Submit button',
}

type Props = {
  doc: Document
  selected: string
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
  select: (id: string) => void
}

/** The Add panel: element tiles to drag onto the page, or insert at a chosen position. */
export function InsertPanel({
  doc,
  root,
  selected,
  disabled,
  save,
  select,
}: Props & { root: string }) {
  const [preset, setPreset] = useState<Preset | 'collection'>('heading')
  const collections = Object.values(doc.collections)
  const [collection, setCollection] = useState('')
  const listOf = doc.collections[collection] ?? collections[0]
  const [placement, setPlacement] = useState<Placement>('page')
  const [classId, setClassId] = useState('')
  let target: ReturnType<typeof insertionTarget> | undefined
  let reason = ''
  try {
    const at = insertionTarget(doc, root, selected, placement)
    if (preset !== 'collection') dropTarget(doc, root, { preset }, at.parent, at.index)
    target = at
  } catch (error) {
    reason = (error as Error).message
  }
  const parent = target && doc.nodes[target.parent]
  return (
    <div className="structure-panel">
      <div className="insert-fields">
        {[
          { label: 'Structure', items: [...structures, 'list'] as const },
          { label: 'Text', items: ['heading', 'paragraph', 'span'] as const },
          { label: 'Media', items: ['image', 'video', 'embed'] as const },
          { label: 'Actions', items: actions },
          { label: 'Forms', items: ['form', ...formFields] as const },
        ].map((group) => (
          <section className="insert-category" key={group.label}>
            <h3>{group.label}</h3>
            <div className="insert-tiles">
              {group.items.map((name) => (
                <button
                  type="button"
                  key={name}
                  draggable={!disabled}
                  data-drag-preset={name}
                  data-drag-class={classId}
                  title={`Drag ${(tileLabels[name] ?? name).toLowerCase()} onto the page`}
                  aria-pressed={preset === name}
                  onClick={() => {
                    setPreset(name)
                  }}
                >
                  <EditorIcon name={name} />
                  {tileLabels[name] ?? name[0]!.toUpperCase() + name.slice(1)}
                </button>
              ))}
            </div>
          </section>
        ))}
        <section className="insert-category">
          <h3>CMS</h3>
          <div className="insert-tiles">
            <button
              type="button"
              title={
                collections.length
                  ? 'A list of entries, designed once'
                  : 'Create a collection in the CMS first'
              }
              aria-pressed={preset === 'collection'}
              disabled={!collections.length}
              onClick={() => setPreset('collection')}
            >
              <EditorIcon name="database" />
              Collection list
            </button>
          </div>
        </section>
        {preset === 'collection' && collections.length > 1 && (
          <label>
            Collection
            <select
              aria-label="Collection to list"
              value={listOf?.id}
              onChange={(event) => setCollection(event.target.value)}
            >
              {collections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Position
          <select
            aria-label="Insert position"
            value={placement}
            onChange={(event) => setPlacement(event.target.value as Placement)}
          >
            <option value="page">End of page</option>
            <option value="inside">Inside selection</option>
            <option value="after">After selection</option>
          </select>
        </label>
        <label>
          Style class
          <select
            aria-label="Insert style class"
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
          >
            <option value="">None</option>
            {Object.values(doc.classes)
              .filter((item) => item.kind === 'class')
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </label>
        <p className="insert-hint">
          {disabled
            ? 'Waiting for pending changes or a resolved conflict.'
            : reason ||
              `Add to ${parent ? nodeLabel(parent) : 'page'}, position ${(target?.index ?? 0) + 1}.`}
        </p>
        <button
          type="button"
          className="primary"
          disabled={disabled || !target}
          onClick={async () => {
            if (!target) return
            if (preset === 'collection') {
              if (!listOf) return
              const { node, operations } = listInsertion(doc, listOf, target)
              if (await save(operations)) select(node.id!)
              return
            }
            const { node, operations } = dropEdit(
              doc,
              root,
              { preset, classId },
              target.parent,
              target.index,
            )
            if (await save(operations)) select(node.id)
          }}
        >
          Insert element
        </button>
      </div>
    </div>
  )
}

/** Duplicate, delete, wrap and reorder the selected element. */
export function ElementActions({
  nodeAction,
  doc,
  selected,
  disabled,
  save,
  select,
}: Props & { nodeAction: (action: NodeAction, id: string) => void }) {
  const [wrapper, setWrapper] = useState<Wrapper>('container')
  const wrap = wrapTarget(doc, selected, wrapper)
  const wrapReason = typeof wrap === 'string' ? wrap : ''
  const up = siblingMove(doc, selected, -1)
  const down = siblingMove(doc, selected, 1)
  const restriction = subtreeRestriction(doc, selected)
  return (
    <div className="structure-panel">
      <div className="element-edit-actions">
        <button
          type="button"
          disabled={disabled || !!restriction}
          title={restriction}
          onClick={() => nodeAction('duplicate', selected)}
        >
          Duplicate element
        </button>
        <button
          type="button"
          disabled={disabled || !!restriction}
          title={restriction}
          onClick={() => nodeAction('delete', selected)}
        >
          Delete element
        </button>
      </div>
      <details>
        <summary>Wrap selection in…</summary>
        <div className="insert-fields">
          <label>
            Structure
            <select
              aria-label="Wrap structure"
              value={wrapper}
              onChange={(event) => setWrapper(event.target.value as Wrapper)}
            >
              {wrappers.map((name) => (
                <option key={name} value={name}>
                  {name[0]!.toUpperCase() + name.slice(1)}
                </option>
              ))}
            </select>
          </label>
          {wrapReason && <p className="insert-hint">{wrapReason}</p>}
          <button
            type="button"
            disabled={disabled || !!wrapReason}
            onClick={async () => {
              const { node, operations } = wrapSelection(doc, selected, wrapper)
              if (await save(operations)) select(node.id)
            }}
          >
            Wrap selection
          </button>
        </div>
      </details>
      <div className="structure-order">
        <span>Layer order</span>
        <div className="history-controls">
          {(
            [
              { name: 'Move up', icon: 'up', operation: up },
              { name: 'Move down', icon: 'down', operation: down },
            ] as const
          ).map(({ name, icon, operation }) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              title={name}
              disabled={disabled || !operation}
              onClick={() => {
                if (operation) void save([operation])
              }}
            >
              <EditorIcon name={icon} />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
