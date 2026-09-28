import type { GradientValue } from '@lacuno/schema'
import { useId, useRef, useState } from 'react'
import { ColorField } from './ColorField.js'
import { EditorIcon } from './EditorIcon.js'
import {
  addStop,
  clamp,
  defaultCentre,
  defaultGradient,
  moveStop,
  radialBackground,
  removeStop,
  schemaOrder,
  stopColor,
  stopsBackground,
} from './gradient.js'
import { type StyleControls, useStyleField } from './styleField.js'

const TEXT_FILL = ['background-clip', 'color'] as const
const PRESETS = [0, 50, 100]

/**
 * The background gradient: type, a linear angle or a radial shape and centre, and a stops bar;
 * optionally clipped to the text.
 */
export function GradientControls(props: StyleControls) {
  const { doc, change, disabled } = props
  const { local, overridden } = useStyleField(props)
  const id = useId()
  const bar = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState(0)
  const value = local('background-image')
  const clip = local('background-clip')
  const textFill = clip?.type === 'keyword' && clip.value === 'text'
  if (value?.type !== 'gradient')
    return (
      <div className="formatting-wide gradient-add">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setSelected(0)
            change('background-image', defaultGradient)
          }}
        >
          Add gradient
        </button>
      </div>
    )
  const gradient = value
  const index = Math.min(selected, gradient.stops.length - 1)
  const stop = gradient.stops[index]!
  const centre = gradient.at ?? defaultCentre
  const set = (next: GradientValue, stopIndex = index) => {
    setSelected(stopIndex)
    change('background-image', schemaOrder(next))
  }
  const position = (clientX: number) => {
    const rect = bar.current!.getBoundingClientRect()
    return ((clientX - rect.left) / rect.width) * 100
  }
  return (
    <div
      className="formatting-wide gradient-controls"
      data-property="background-image"
      data-overridden={overridden('background-image')}
    >
      <div className="gradient-row">
        <label>
          Gradient
          <select
            aria-label="Gradient type"
            value={gradient.kind}
            disabled={disabled}
            onChange={(event) => {
              const { angle: _angle, shape: _shape, at: _at, ...rest } = gradient
              set(
                event.target.value === 'linear'
                  ? { ...rest, kind: 'linear', angle: 180 }
                  : { ...rest, kind: 'radial' },
              )
            }}
          >
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
          </select>
        </label>
        {gradient.kind === 'linear' && (
          <label>
            Angle (°)
            <input
              aria-label="Gradient angle"
              type="number"
              step="any"
              disabled={disabled}
              value={gradient.angle ?? 180}
              onChange={(event) => set({ ...gradient, angle: Number(event.target.value) })}
            />
          </label>
        )}
        {gradient.kind === 'radial' && (
          <label>
            Shape
            <select
              aria-label="Gradient shape"
              value={gradient.shape ?? 'ellipse'}
              disabled={disabled}
              onChange={(event) =>
                set({ ...gradient, shape: event.target.value as 'ellipse' | 'circle' })
              }
            >
              <option value="ellipse">Ellipse</option>
              <option value="circle">Circle</option>
            </select>
          </label>
        )}
        <button
          type="button"
          className="gradient-remove"
          aria-label="Remove gradient"
          title="Remove gradient"
          disabled={disabled}
          onClick={() => {
            change('background-image', null)
            if (textFill) for (const property of TEXT_FILL) change(property, null)
          }}
        >
          <EditorIcon name="close" />
        </button>
      </div>
      {gradient.kind === 'radial' && (
        <div className="gradient-row">
          {/* The gradient itself, with a preset centre at each corner, edge and the middle. */}
          <fieldset
            className="gradient-centre"
            aria-label="Gradient centre"
            style={{ backgroundImage: radialBackground(doc, gradient) }}
          >
            {PRESETS.flatMap((y) =>
              PRESETS.map((x) => (
                <button
                  key={`${x} ${y}`}
                  type="button"
                  aria-label={`Centre at ${x}% ${y}%`}
                  title={`${x}% ${y}%`}
                  aria-pressed={centre.x === x && centre.y === y}
                  disabled={disabled}
                  onClick={() => set({ ...gradient, at: { x, y } })}
                />
              )),
            )}
          </fieldset>
          {(['x', 'y'] as const).map((axis) => (
            <label key={axis}>
              {axis.toUpperCase()} (%)
              <input
                aria-label={`Centre ${axis}`}
                type="number"
                min={0}
                max={100}
                disabled={disabled}
                value={centre[axis]}
                onChange={(event) =>
                  set({ ...gradient, at: { ...centre, [axis]: clamp(Number(event.target.value)) } })
                }
              />
            </label>
          ))}
        </div>
      )}
      {/* Pressing the bar adds a stop there; the stops themselves are buttons. */}
      <div
        ref={bar}
        className="gradient-bar"
        style={{ backgroundImage: stopsBackground(doc, gradient) }}
        onPointerDown={(event) => {
          if (disabled || event.target !== event.currentTarget) return
          set(...addStop(gradient, position(event.clientX)))
        }}
      >
        {gradient.stops.map((item, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: stops have no identity but their order.
            key={i}
            type="button"
            className="gradient-stop"
            aria-label={`Stop ${i + 1} at ${item.position}%`}
            aria-pressed={i === index}
            disabled={disabled}
            style={{ left: `${item.position}%`, background: stopColor(doc, item) }}
            onPointerDown={(event) => {
              setSelected(i)
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
              // After a stop passes another the order changes, so move the selected stop.
              set(...moveStop(gradient, index, position(event.clientX)))
            }}
            onKeyDown={(event) => {
              const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
              if (!step) return
              event.preventDefault()
              set(...moveStop(gradient, i, item.position + step * (event.shiftKey ? 10 : 1)))
            }}
          />
        ))}
      </div>
      <div className="gradient-stop-fields">
        <ColorField
          doc={doc}
          property="color"
          label="Stop color"
          id={`${id}-color`}
          value={stop.color}
          placeholder="e.g. #6952d9"
          disabled={disabled}
          set={(next) => {
            // Leaving a project colour keeps its value as a custom colour.
            const color =
              next?.type === 'color' || next?.type === 'designToken'
                ? next
                : { type: 'color' as const, value: stopColor(doc, stop) }
            set({
              ...gradient,
              stops: gradient.stops.map((item, i) => (i === index ? { ...item, color } : item)),
            })
          }}
        />
        <div className="gradient-row">
          <label>
            Position (%)
            <input
              aria-label="Stop position"
              type="number"
              min={0}
              max={100}
              disabled={disabled}
              value={stop.position}
              onChange={(event) => set(...moveStop(gradient, index, Number(event.target.value)))}
            />
          </label>
          <button
            type="button"
            disabled={disabled || gradient.stops.length <= 2}
            onClick={() => set(removeStop(gradient, index), Math.max(0, index - 1))}
          >
            Remove stop
          </button>
        </div>
      </div>
      <label className="gradient-text">
        <input
          type="checkbox"
          checked={textFill}
          disabled={disabled}
          onChange={(event) => {
            if (!event.target.checked) for (const property of TEXT_FILL) change(property, null)
            else {
              change('background-clip', { type: 'keyword', value: 'text' })
              change('color', { type: 'keyword', value: 'transparent' })
            }
          }}
        />
        Fill text
      </label>
    </div>
  )
}
