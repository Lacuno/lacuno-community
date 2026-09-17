import type { Document } from '@freeflow/schema'
import { useState } from 'react'
import type { EditOperation } from './history.js'
import {
  insertionTarget,
  type Placement,
  type Preset,
  presetNode,
  siblingMove,
} from './structure.js'

export function StructurePanel({
  doc,
  root,
  selected,
  disabled,
  save,
  select,
}: {
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
      <details>
        <summary>Add element</summary>
        <div className="insert-fields">
          <label>
            Element
            <select
              aria-label="Element type"
              value={preset}
              onChange={(event) => setPreset(event.target.value as Preset)}
            >
              <option value="heading">Heading</option>
              <option value="paragraph">Paragraph</option>
              <option value="section">Section</option>
              <option value="container">Empty container</option>
            </select>
          </label>
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
              {Object.values(doc.classes).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <p className="insert-hint">
            {disabled
              ? 'Finish saving, discard your draft, or resolve the conflict to change structure.'
              : reason ||
                `Add to ${parent?.meta?.label ?? (parent && 'tag' in parent ? parent.tag : 'page')}, position ${(target?.index ?? 0) + 1}.`}
          </p>
          <button
            type="button"
            className="primary"
            disabled={disabled || !target}
            onClick={async () => {
              if (!target) return
              const node = presetNode(preset, classId)
              if (await save([{ type: 'node.create', ...target, node }])) select(node.id)
            }}
          >
            Insert element
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
    </div>
  )
}
