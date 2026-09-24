import { contextFromDocument, serializeValue } from '@miralo/css'
import type { CssValue, Document, Node, State } from '@miralo/schema'
import { localValue } from './formatting.js'
import { presetValues } from './presets.js'

export type StyleControls = {
  breakpoint?: string
  state?: State
  doc: Document
  node: Node
  computed: Record<string, string>
  changes: Record<string, CssValue | null>
  change: (property: string, value: CssValue | null) => void
  disabled: boolean
}

/** Read and write the effective value of one style property at the edited breakpoint and state. */
export function useStyleField({
  breakpoint = 'base',
  state = 'none',
  doc,
  node,
  computed,
  changes,
  change,
}: StyleControls) {
  const inherited = presetValues(doc, node, computed, breakpoint, state)
  /** The draft value, else the one set locally at this breakpoint and state. */
  const local = (property: string) =>
    property in changes ? changes[property] : localValue(doc, node, property, breakpoint, state)
  return {
    local,
    overridden: (property: string) =>
      (breakpoint !== 'base' || state !== 'none') && !!local(property),
    value: (property: string, fallback = '') => {
      const item = property in changes ? changes[property] : inherited[property]
      return item ? serializeValue(item, contextFromDocument(doc)) : fallback
    },
    set: (property: string, text: string) =>
      change(property, text ? { type: 'raw', value: text } : null),
  }
}

/** A number input that shows a scaled value and writes it back clamped, with its unit. */
export function NumberField({
  label,
  name,
  id,
  value,
  factor = 1,
  unit = '',
  min,
  max,
  disabled,
  overridden,
  set,
}: {
  label: string
  name?: string | undefined
  id?: string | undefined
  value: string
  factor?: number
  unit?: string
  min?: number | undefined
  max?: number | undefined
  disabled: boolean
  overridden: boolean
  set: (value: string) => void
}) {
  return (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        aria-label={name ?? label}
        data-overridden={overridden}
        type="number"
        min={min}
        max={max}
        step="any"
        disabled={disabled}
        value={value ? Math.round(Number.parseFloat(value) * factor * 1000) / 1000 : ''}
        onChange={(event) =>
          set(
            event.target.value
              ? `${Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Number(event.target.value))) / factor}${unit}`
              : '',
          )
        }
      />
    </label>
  )
}
