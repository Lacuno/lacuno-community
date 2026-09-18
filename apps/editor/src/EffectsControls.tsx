import { contextFromDocument, serializeValue } from '@freeflow/css'
import type { CssValue, Document, Node } from '@freeflow/schema'
import { useId, useRef } from 'react'
import { defaultShadow, readShadow, readTilt, writeShadow, writeTilt } from './effects.js'
import { presetValues } from './presets.js'

export function EffectsControls({
  doc,
  node,
  computed,
  changes,
  change,
  disabled,
}: {
  doc: Document
  node: Node
  computed: Record<string, string>
  changes: Record<string, CssValue | null>
  change: (property: string, value: CssValue | null) => void
  disabled: boolean
}) {
  const inherited = presetValues(doc, node, computed)
  const value = (property: string, fallback: string) => {
    const item = property in changes ? changes[property] : inherited[property]
    return item ? serializeValue(item, contextFromDocument(doc)) : fallback
  }
  const set = (property: string, text: string) =>
    change(property, text ? { type: 'raw', value: text } : null)
  const tiltText = value('transform', 'none')
  const tilt = readTilt(tiltText)
  const shadowText = value('box-shadow', 'none')
  const shadow = readShadow(shadowText)
  const shadowId = useId()
  const shadowPanel = useRef<HTMLDivElement>(null)
  const scalar = (
    property: string,
    label: string,
    fallback: string,
    factor: number,
    unit = '',
    min?: number,
    max?: number,
  ) => {
    const text = value(property, fallback)
    const match = text === 'none' ? fallback : text
    const numeric = unit ? /^-?(?:\d*\.)?\d+(?:deg)?$/.test(match) : /^-?(?:\d*\.)?\d+$/.test(match)
    return (
      <label htmlFor={`${shadowId}-${property}`}>
        {label}
        {numeric ? (
          <input
            id={`${shadowId}-${property}`}
            aria-label={label}
            type="number"
            min={min}
            max={max}
            step="any"
            disabled={disabled}
            value={Math.round(Number.parseFloat(match) * factor * 1000) / 1000}
            onChange={(event) =>
              set(
                property,
                event.target.value
                  ? `${Math.min(max ?? Infinity, Math.max(min ?? -Infinity, Number(event.target.value))) / factor}${unit}`
                  : '',
              )
            }
          />
        ) : (
          <input
            id={`${shadowId}-${property}`}
            aria-label={label}
            disabled={disabled}
            value={text}
            onChange={(event) => set(property, event.target.value)}
          />
        )}
      </label>
    )
  }
  return (
    <div className="effects-grid">
      {scalar('opacity', 'Opacity (%)', '1', 100, '', 0, 100)}
      {scalar('rotate', 'Rotation (°)', '0deg', 1, 'deg')}
      {scalar('scale', 'Scale (%)', '1', 100, '', 0)}
      {tilt ? (
        (['x', 'y'] as const).map((axis) => (
          <label key={axis}>
            Tilt {axis.toUpperCase()} (°)
            <input
              aria-label={`Tilt ${axis.toUpperCase()} (°)`}
              type="number"
              step="any"
              min={-89}
              max={89}
              disabled={disabled}
              value={tilt[axis]}
              onChange={(event) =>
                set(
                  'transform',
                  writeTilt({
                    ...tilt,
                    [axis]: Math.min(89, Math.max(-89, Number(event.target.value))),
                  }),
                )
              }
            />
          </label>
        ))
      ) : (
        <label className="effect-custom">
          Custom transform
          <input
            aria-label="Custom transform"
            disabled={disabled}
            value={tiltText}
            onChange={(event) => set('transform', event.target.value)}
          />
        </label>
      )}
      <div className="effect-shadow-trigger">
        <span>Box shadow</span>
        <button
          type="button"
          disabled={disabled}
          popoverTarget={shadowId}
          aria-haspopup="dialog"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            if (shadowPanel.current) {
              shadowPanel.current.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - 310))}px`
              shadowPanel.current.style.top = `${Math.max(12, Math.min(rect.bottom + 8, innerHeight - 390))}px`
            }
          }}
        >
          {shadowText === 'none' ? 'Add shadow…' : 'Edit shadow…'}
        </button>
      </div>
      <div
        ref={shadowPanel}
        id={shadowId}
        popover="auto"
        role="dialog"
        aria-label="Box shadow"
        className="effect-shadow-popover"
      >
        <strong>Box shadow</strong>
        <p className="hint">Changes apply immediately.</p>
        {shadow ? (
          <div className="shadow-fields">
            {(['x', 'y', 'blur', 'spread'] as const).map((key) => (
              <label key={key}>
                {{ x: 'Horizontal', y: 'Vertical', blur: 'Blur', spread: 'Spread' }[key]} (px)
                <input
                  aria-label={`Shadow ${key}`}
                  type="number"
                  step="any"
                  min={key === 'blur' ? 0 : undefined}
                  disabled={disabled}
                  value={shadow[key]}
                  onChange={(event) =>
                    set(
                      'box-shadow',
                      writeShadow({
                        ...shadow,
                        [key]:
                          key === 'blur'
                            ? Math.max(0, Number(event.target.value))
                            : Number(event.target.value),
                      }),
                    )
                  }
                />
              </label>
            ))}
            <div className="color-value-row effect-custom">
              <label>
                Color
                <input
                  aria-label="Shadow color"
                  disabled={disabled}
                  value={shadow.color}
                  onChange={(event) =>
                    set('box-shadow', writeShadow({ ...shadow, color: event.target.value }))
                  }
                />
              </label>
              <label className="color-picker-label">
                Pick
                <input
                  type="color"
                  aria-label="Shadow color picker"
                  disabled={disabled}
                  value={
                    /^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(shadow.color)
                      ? shadow.color.slice(0, 7)
                      : '#000000'
                  }
                  onChange={(event) => {
                    const alpha = /^#[a-f0-9]{8}$/i.test(shadow.color) ? shadow.color.slice(7) : ''
                    set(
                      'box-shadow',
                      writeShadow({ ...shadow, color: `${event.target.value}${alpha}` }),
                    )
                  }}
                />
              </label>
            </div>
            <label className="shadow-inset">
              <input
                type="checkbox"
                checked={shadow.inset}
                disabled={disabled}
                onChange={(event) =>
                  set('box-shadow', writeShadow({ ...shadow, inset: event.target.checked }))
                }
              />
              Inset
            </label>
          </div>
        ) : (
          <label>
            Custom shadow
            <input
              aria-label="Custom shadow"
              disabled={disabled}
              value={shadowText}
              onChange={(event) => set('box-shadow', event.target.value)}
            />
          </label>
        )}
        <div className="row">
          {shadowText === 'none' && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => set('box-shadow', writeShadow(defaultShadow))}
            >
              Apply shadow
            </button>
          )}
          <button
            type="button"
            disabled={disabled || shadowText === 'none'}
            onClick={() => set('box-shadow', 'none')}
          >
            Remove shadow
          </button>
          <button type="button" popoverTarget={shadowId} popoverTargetAction="hide">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
