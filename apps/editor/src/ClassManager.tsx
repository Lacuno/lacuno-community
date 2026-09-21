import { nodesUsingClass, type Operation } from '@freeflow/document'
import type { Document, Node } from '@freeflow/schema'
import { useState } from 'react'
import { ErrorNote } from './Dialog.js'
import { nodeLabel } from './structure.js'
import { useDirtyChanged } from './useAutosave.js'

export function ClassManager({
  doc,
  node,
  disabled,
  save,
  draftChanged,
}: {
  doc: Document
  node: Node
  disabled: boolean
  draftChanged: (dirty: boolean) => void
  save: (operations: Operation[]) => Promise<boolean>
}) {
  const [name, setName] = useState('')
  const [existing, setExisting] = useState('')
  const [error, setError] = useState('')
  useDirtyChanged(!!name || !!existing, draftChanged)
  const available = Object.values(doc.classes)
    .filter((cls) => cls.kind === 'class' && !cls.preset && !node.classes.includes(cls.id))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  const location = (item: Node) => {
    let current: Node | undefined = item
    while (current) {
      const page = Object.values(doc.pages).find((page) => page.root === current?.id)
      if (page) return page.name
      const component = Object.values(doc.components).find(
        (component) => component.root === current?.id,
      )
      if (component) return `Shared component: ${component.name}`
      current = current.parent ? doc.nodes[current.parent] : undefined
    }
    return 'Project'
  }
  return (
    <section className="class-manager" aria-label="Element classes">
      <div className="section-label">CLASSES</div>
      <ul className="assigned-classes">
        {node.classes
          .filter((id) => doc.classes[id]?.kind !== 'local' && !doc.classes[id]?.preset)
          .map((id) => {
            const cls = doc.classes[id]!
            const uses = nodesUsingClass(doc, id).map((nodeId) => doc.nodes[nodeId]!)
            return (
              <li key={id}>
                <details>
                  <summary>
                    {cls.name ?? 'Local style'}{' '}
                    <span>
                      {uses.length} {uses.length === 1 ? 'element' : 'elements'}
                    </span>
                  </summary>
                  <ul>
                    {uses.map((item) => (
                      <li key={item.id}>
                        {nodeLabel(item)} <small>{location(item)}</small>
                      </li>
                    ))}
                  </ul>
                </details>
                <button
                  type="button"
                  disabled={disabled || cls.locked || !!name || !!existing}
                  aria-label={`Remove class ${cls.name ?? 'Local style'}`}
                  title="Remove from this element"
                  onClick={() =>
                    void save([
                      {
                        type: 'node.update',
                        id: node.id,
                        classes: node.classes.filter((item) => item !== id),
                      },
                    ])
                  }
                >
                  Remove
                </button>
              </li>
            )
          })}
      </ul>
      <details open={node.classes.length === 0} className="class-actions">
        <summary>Assign or create class</summary>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (existing && !disabled)
              await save([
                { type: 'node.update', id: node.id, classes: [...node.classes, existing] },
              ])
          }}
        >
          <label>
            Assign class
            <select
              aria-label="Assign class"
              value={existing}
              disabled={disabled}
              onChange={(event) => setExisting(event.target.value)}
            >
              <option value="">Choose a class</option>
              {available.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={disabled || !existing}>
            Assign class
          </button>
        </form>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setError('')
            const trimmed = name.trim()
            if (!trimmed || disabled) return
            if (Object.values(doc.classes).some((cls) => cls.name === trimmed)) {
              setError('A class with this name already exists.')
              return
            }
            const id = `c-${crypto.randomUUID()}`
            await save([
              { type: 'class.create', id, name: trimmed },
              { type: 'node.update', id: node.id, classes: [...node.classes, id] },
            ])
          }}
        >
          <label>
            New class name
            <input
              value={name}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. feature-heading"
            />
          </label>
          <button type="submit" disabled={disabled || !name.trim()}>
            Create and assign
          </button>
        </form>
        <ErrorNote message={error} />
        <p className="hint">
          Class changes apply immediately. Finish any pending formatting first.
        </p>
      </details>
    </section>
  )
}
