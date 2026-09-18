import { contextFromDocument, serializeValue } from '@freeflow/css'
import type { CssValue, Document, Node } from '@freeflow/schema'
import { localValue } from './formatting.js'
import { presetValues } from './presets.js'

export function MotionControls({
  breakpoint = 'base',
  doc,
  node,
  computed,
  changes,
  change,
  disabled,
}: {
  breakpoint?: string
  doc: Document
  node: Node
  computed: Record<string, string>
  changes: Record<string, CssValue | null>
  change: (property: string, value: CssValue | null) => void
  disabled: boolean
}) {
  const overridden = (property: string) =>
    breakpoint !== 'base' &&
    !!(property in changes ? changes[property] : localValue(doc, node, property, breakpoint))
  const values = presetValues(doc, node, computed, breakpoint)
  const read = (property: string, fallback = '') => {
    const value = property in changes ? changes[property] : values[property]
    return value ? serializeValue(value, contextFromDocument(doc)) : fallback
  }
  const set = (property: string, value: string) =>
    change(property, value ? { type: 'raw', value } : null)
  const preview = (kind: string) =>
    window.dispatchEvent(
      new CustomEvent('freeflow:motion-preview', { detail: { id: node.id, kind } }),
    )
  return (
    <div className="motion-controls">
      <div className="motion-timing">
        {(['duration', 'delay'] as const).map((key) => (
          <label key={key}>
            {key === 'duration' ? 'Duration (ms)' : 'Delay (ms)'}
            <input
              aria-label={`Motion ${key}`}
              data-overridden={overridden(`--ff-${key}`)}
              type="number"
              min="0"
              max="10000"
              disabled={disabled}
              value={Number.parseFloat(read(`--ff-${key}`, key === 'duration' ? '400ms' : '0ms'))}
              onChange={(event) =>
                set(`--ff-${key}`, `${Math.min(10000, Math.max(0, Number(event.target.value)))}ms`)
              }
            />
          </label>
        ))}
        <label>
          Easing
          <select
            aria-label="Motion easing"
            data-overridden={overridden('--ff-easing')}
            disabled={disabled}
            value={read('--ff-easing', 'ease-out')}
            onChange={(event) => set('--ff-easing', event.target.value)}
          >
            {['ease-out', 'ease-in-out', 'ease-in', 'ease', 'linear'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Entrance
          <select
            aria-label="Entrance animation"
            data-overridden={overridden('--ff-entrance')}
            disabled={disabled}
            value={read('--ff-entrance', 'none')}
            onChange={(event) => set('--ff-entrance', event.target.value)}
          >
            {Object.entries({
              none: 'None',
              'ff-fade': 'Fade in',
              'ff-slide-up': 'Slide up',
              'ff-slide-down': 'Slide down',
              'ff-slide-left': 'Slide left',
              'ff-slide-right': 'Slide right',
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || read('--ff-entrance', 'none') === 'none'}
          onClick={() => preview('entrance')}
        >
          Preview entrance
        </button>
      </div>
      <div className="motion-hover">
        {[
          { key: 'opacity', label: 'Hover opacity (%)', factor: 100, unit: '', min: 0, max: 100 },
          { key: 'scale', label: 'Hover scale (%)', factor: 100, unit: '', min: 0, max: 1000 },
          {
            key: 'rotate',
            label: 'Hover rotation (°)',
            factor: 1,
            unit: 'deg',
            min: -360,
            max: 360,
          },
        ].map(({ key, label, factor, unit, min, max }) => {
          const raw = read(`--ff-hover-${key}`)
          return (
            <label key={key}>
              {label}
              <input
                aria-label={label}
                data-overridden={overridden(`--ff-hover-${key}`)}
                type="number"
                min={min}
                max={max}
                step="any"
                placeholder="Unchanged"
                disabled={disabled}
                value={raw ? Number.parseFloat(raw) * factor : ''}
                onChange={(event) =>
                  set(
                    `--ff-hover-${key}`,
                    event.target.value
                      ? `${Math.min(max, Math.max(min, Number(event.target.value))) / factor}${unit}`
                      : '',
                  )
                }
              />
            </label>
          )
        })}
        <label>
          Hover shadow
          <select
            aria-label="Hover shadow"
            data-overridden={overridden('--ff-hover-box-shadow')}
            disabled={disabled}
            value={read('--ff-hover-box-shadow')}
            onChange={(event) => set('--ff-hover-box-shadow', event.target.value)}
          >
            <option value="">Unchanged</option>
            <option value="none">None</option>
            <option value="0px 4px 12px 0px #00000026">Soft</option>
            <option value="0px 12px 32px 0px #00000033">Elevated</option>
          </select>
        </label>
        <button type="button" disabled={disabled} onClick={() => preview('hover')}>
          Preview hover
        </button>
      </div>
      <p className="hint">
        Entrances play once on entering the viewport. Reduced-motion preferences are respected.
      </p>
    </div>
  )
}
