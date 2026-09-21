import { nodesUsingClass, type Operation } from '@freeflow/document'
import type { Document, Node } from '@freeflow/schema'
import { useEffect, useId, useRef, useState } from 'react'
import { ErrorNote } from './Dialog.js'
import { formattingOperations } from './formatting.js'
import { placePopover } from './popover.js'
import {
  activePreset,
  applyPreset,
  createPreset,
  presetOverrides,
  updatePreset,
} from './presets.js'
import { useDirtyChanged } from './useAutosave.js'

export function PresetManager({
  breakpoint = 'base',
  doc,
  node,
  computed,
  disabled,
  save,
  draftChanged,
}: {
  breakpoint?: string
  doc: Document
  node: Node
  computed: Record<string, string>
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
  draftChanged: (dirty: boolean) => void
}) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const actionsId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const positionPopover = () => placePopover(trigger.current, popover.current)
  useEffect(() => {
    if (!creating) return
    nameInput.current?.focus()
  }, [creating])
  useDirtyChanged(!!name, draftChanged)
  const current = activePreset(doc, node)
  const presets = Object.values(doc.classes)
    .filter((cls) => cls.preset && cls.kind === 'class' && !cls.combo?.length)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  const overrides = presetOverrides(doc, node, breakpoint)
  const uses = current ? nodesUsingClass(doc, current.id).length : 0
  const run = async (operations: () => Operation[]) => {
    setError('')
    try {
      return await save(operations())
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not change preset.')
      return false
    }
  }
  const runAction = async (operations: () => Operation[]) => {
    if (await run(operations)) popover.current?.hidePopover()
  }
  return (
    <section className="preset-manager" aria-label="Formatting presets">
      <label>
        <span>Preset</span>
        <select
          aria-label="Preset"
          value={current?.id ?? ''}
          disabled={disabled || !!name || !!current?.locked}
          onChange={(event) => {
            const id = event.target.value
            void run(() => applyPreset(doc, node, id))
          }}
        >
          <option value="">No preset</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>
      {!!overrides.length && <span className="preset-customized">Customized</span>}
      <button
        ref={trigger}
        type="button"
        className="preset-actions-trigger"
        aria-label="Preset actions"
        title="Preset actions"
        disabled={disabled}
        popoverTarget={actionsId}
        aria-haspopup="dialog"
        onClick={positionPopover}
      >
        •••
      </button>
      <div
        ref={popover}
        id={actionsId}
        popover="auto"
        role="dialog"
        aria-label="Preset actions"
        className="preset-actions-popover"
        onToggle={(event) => {
          if (event.newState === 'open') {
            positionPopover()
            return
          }
          setCreating(false)
          setName('')
          setError('')
        }}
      >
        {creating ? (
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              if (await run(() => createPreset(doc, node, name, computed, undefined, breakpoint)))
                popover.current?.hidePopover()
            }}
          >
            <strong className="preset-popover-title">Create preset</strong>
            <p className="hint">Reuse this element’s typography, colors, and spacing.</p>
            <label>
              Preset name
              <input
                ref={nameInput}
                value={name}
                disabled={disabled}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Page heading"
              />
            </label>
            <ErrorNote message={error} />
            <div className="row">
              <button type="submit" disabled={disabled || !name.trim()}>
                Create preset
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <strong className="preset-popover-title">Preset actions</strong>
            <p className="hint">
              {current
                ? `${overrides.length ? 'Customized at this size' : breakpoint === 'base' ? 'Following preset' : 'Preset / inherited styles'} · ${uses} ${uses === 1 ? 'element' : 'elements'}`
                : 'Reuse typography, colors, and spacing across your project.'}
            </p>
            {current && (
              <>
                <button
                  type="button"
                  disabled={disabled || !overrides.length || current.locked}
                  onClick={() => void runAction(() => updatePreset(doc, node, breakpoint))}
                >
                  Update preset · {uses} {uses === 1 ? 'element' : 'elements'}
                </button>
                <button
                  type="button"
                  disabled={disabled || !overrides.length}
                  onClick={() =>
                    void runAction(() =>
                      formattingOperations(
                        doc,
                        node,
                        Object.fromEntries(overrides.map((style) => [style.property, null])),
                        undefined,
                        breakpoint,
                      ),
                    )
                  }
                >
                  Reset to preset
                </button>
              </>
            )}
            <button type="button" disabled={disabled} onClick={() => setCreating(true)}>
              Create preset from selection
            </button>
          </>
        )}
      </div>
    </section>
  )
}
