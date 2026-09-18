import type { Document, Node } from '@freeflow/schema'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { formattingOperations } from './formatting.js'
import type { EditOperation } from './history.js'
import {
  activePreset,
  applyPreset,
  createPreset,
  presetOverrides,
  updatePreset,
} from './presets.js'

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
  save: (operations: EditOperation[]) => Promise<boolean>
  draftChanged: (dirty: boolean) => void
}) {
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const popoverId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const positionPopover = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect()
    const panel = popover.current
    if (!anchor || !panel) return
    const width = Math.min(290, window.innerWidth - 24)
    const height = panel.offsetHeight || 200
    panel.style.left = `${Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12))}px`
    panel.style.top = `${Math.max(12, anchor.bottom + height + 8 <= window.innerHeight - 12 ? anchor.bottom + 8 : anchor.top - height - 8)}px`
  }, [])
  useEffect(() => {
    if (!creating) return
    positionPopover()
    nameInput.current?.focus()
    window.addEventListener('resize', positionPopover)
    window.addEventListener('scroll', positionPopover, true)
    return () => {
      window.removeEventListener('resize', positionPopover)
      window.removeEventListener('scroll', positionPopover, true)
    }
  }, [creating, positionPopover])
  useEffect(() => {
    draftChanged(!!name)
  }, [name, draftChanged])
  const current = activePreset(doc, node)
  const presets = Object.values(doc.classes)
    .filter((cls) => cls.preset && cls.kind === 'class' && !cls.combo?.length)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  const overrides = presetOverrides(doc, node, breakpoint)
  const uses = current
    ? Object.values(doc.nodes).filter((item) => item.classes.includes(current.id)).length
    : 0
  const run = async (operations: () => EditOperation[]) => {
    setError('')
    try {
      await save(operations())
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not change preset.')
    }
  }
  return (
    <section className="preset-manager" aria-label="Formatting presets">
      <label>
        Preset
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
      {current ? (
        <>
          <p className="hint">
            {overrides.length
              ? 'Customized at this size'
              : breakpoint === 'base'
                ? 'Following preset'
                : 'Preset / inherited styles'}{' '}
            · {uses} {uses === 1 ? 'element' : 'elements'}
          </p>
          <button
            type="button"
            disabled={disabled || !!name || !overrides.length || current.locked}
            onClick={() => void run(() => updatePreset(doc, node, breakpoint))}
          >
            Update preset · {uses} {uses === 1 ? 'element' : 'elements'}
          </button>
          <button
            type="button"
            disabled={disabled || !!name || !overrides.length}
            onClick={() =>
              void run(() =>
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
      ) : (
        <p className="hint">Reuse typography, colors, and spacing across your project.</p>
      )}
      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        popoverTarget={popoverId}
        aria-haspopup="dialog"
        aria-expanded={creating}
        onClick={positionPopover}
      >
        Create preset from selection
      </button>
      <div
        ref={popover}
        id={popoverId}
        popover="auto"
        role="dialog"
        aria-label="Create preset"
        className="preset-creation-popover"
        onToggle={(event) => {
          const open = event.newState === 'open'
          setCreating(open)
          if (!open) {
            setName('')
            setError('')
          }
        }}
      >
        <strong>Create preset</strong>
        <p className="hint">Reuse this element’s typography, colors, and spacing.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void run(() => createPreset(doc, node, name, computed, undefined, breakpoint))
          }}
        >
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
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <button type="submit" disabled={disabled || !name.trim()}>
              Create preset
            </button>
            <button
              type="button"
              onClick={() => {
                popover.current?.hidePopover()
                trigger.current?.focus()
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
      {error && !creating && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
