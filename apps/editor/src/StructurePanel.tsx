import type { Document } from '@freeflow/schema'
import { useState } from 'react'
import type { EditOperation } from './history.js'
import {
  insertionTarget,
  type Placement,
  type Preset,
  type Structure,
  siblingMove,
  structureInsertion,
  structures,
  subtreeRestriction,
  wrapSelection,
} from './structure.js'

export function StructurePanel({
  mode = 'add',
  nodeAction,
  doc,
  root,
  selected,
  disabled,
  save,
  select,
}: {
  mode?: 'add' | 'actions'
  nodeAction?: (action: 'duplicate' | 'delete') => void
  doc: Document
  root: string
  selected: string
  disabled: boolean
  save: (operations: EditOperation[]) => Promise<boolean>
  select: (id: string) => void
}) {
  const [preset, setPreset] = useState<Preset>('heading')
  const [placement, setPlacement] = useState<Placement>('page')
  const [classId, setClassId] = useState('')
  const [wrapper, setWrapper] = useState<Structure>('container')
  let wrapReason = ''
  try {
    insertionTarget(doc, root, selected, 'after')
  } catch (error) {
    wrapReason = (error as Error).message
  }
  let target: ReturnType<typeof insertionTarget> | undefined
  let reason = ''
  try {
    target = insertionTarget(doc, root, selected, placement)
  } catch (error) {
    reason = (error as Error).message
  }
  const up = siblingMove(doc, selected, -1)
  const down = siblingMove(doc, selected, 1)
  const parent = target && doc.nodes[target.parent]
  return (
    <div className="structure-panel">
      {mode === 'add' && (
        <div className="insert-fields">
          {[
            { label: 'Structure', items: structures },
            { label: 'Text', items: ['heading', 'paragraph'] as const },
            { label: 'Media', items: ['image'] as const },
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
                    title={`Drag ${name} onto the page`}
                    aria-pressed={preset === name}
                    onClick={() => {
                      setPreset(name)
                    }}
                  >
                    <svg
                      viewBox="0 0 32 32"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      aria-hidden="true"
                    >
                      <path d={tilePaths[name]} />
                    </svg>
                    {name[0]!.toUpperCase() + name.slice(1)}
                  </button>
                ))}
              </div>
            </section>
          ))}
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
                `Add to ${parent?.meta?.label ?? (parent && 'tag' in parent ? parent.tag : 'page')}, position ${(target?.index ?? 0) + 1}.`}
          </p>
          <button
            type="button"
            className="primary"
            disabled={disabled || !target}
            onClick={async () => {
              if (!target) return
              const { node, operations } = structureInsertion(preset, target, classId, false)
              if (await save(operations)) select(node.id)
            }}
          >
            Insert element
          </button>
        </div>
      )}
      {mode === 'actions' && (
        <>
          <div className="element-edit-actions">
            <button
              type="button"
              disabled={disabled || !!subtreeRestriction(doc, selected)}
              title={subtreeRestriction(doc, selected)}
              onClick={() => nodeAction?.('duplicate')}
            >
              Duplicate element
            </button>
            <button
              type="button"
              disabled={disabled || !!subtreeRestriction(doc, selected)}
              title={subtreeRestriction(doc, selected)}
              onClick={() => nodeAction?.('delete')}
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
                  onChange={(event) => setWrapper(event.target.value as Structure)}
                >
                  {structures.map((name) => (
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
              {[
                { name: 'Move up', operation: up, path: 'm6 11 6-6 6 6M12 5v14' },
                { name: 'Move down', operation: down, path: 'm6 13 6 6 6-6M12 19V5' },
              ].map(({ name, operation, path }) => (
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
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d={path} />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const tilePaths: Record<Preset, string> = {
  image: 'M3 4h26v24H3zM3 24l9-11 7 8 4-5 6 8M22 9h1',
  section: 'M3 4h26v24H3zM3 10h26M3 23h26',
  container: 'M3 4h26v24H3zM9 9h14v14H9z',
  stack: 'M5 3h22v26H5zM10 9h12M10 16h12M10 23h12',
  row: 'M3 5h26v22H3zM9 10v12M16 10v12M23 10v12',
  grid: 'M4 4h24v24H4zM16 4v24M4 16h24',
  heading: 'M7 5v22M25 5v22M7 16h18',
  paragraph: 'M6 7h20M6 13h20M6 19h20M6 25h12',
}
