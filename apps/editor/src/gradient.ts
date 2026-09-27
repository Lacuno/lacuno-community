import type { Document, GradientStop, GradientValue } from '@lacuno/schema'
import { colorPreview } from './colors.js'

export const defaultGradient: GradientValue = {
  type: 'gradient',
  kind: 'linear',
  angle: 135,
  stops: [
    { color: { type: 'color', value: '#6952d9' }, position: 0 },
    { color: { type: 'color', value: '#e0529c' }, position: 100 },
  ],
}

/** A stop's colour as the editor chrome can paint it; a token resolves to its value. */
export const stopColor = (doc: Document, stop: GradientStop) =>
  stop.color.type === 'designToken' ? colorPreview(doc, stop.color.ref) : stop.color.value

/** The stops left to right, as the editor chrome paints them on the stops bar. */
export const stopsBackground = (doc: Document, gradient: GradientValue) =>
  `linear-gradient(90deg, ${gradient.stops.map((stop) => `${stopColor(doc, stop)} ${stop.position}%`).join(', ')})`

const clamp = (position: number) => Math.round(Math.min(100, Math.max(0, position)))

/** Moves stop `index` and keeps the stops in order; returns the gradient and the stop's new index. */
export function moveStop(
  gradient: GradientValue,
  index: number,
  position: number,
): [GradientValue, number] {
  const moved = { ...gradient.stops[index]!, position: clamp(position) }
  const stops = gradient.stops
    .map((stop, i) => (i === index ? moved : stop))
    .sort((a, b) => a.position - b.position)
  return [{ ...gradient, stops }, stops.indexOf(moved)]
}

/** Adds a stop at `position` in the colour of the stop nearest to it; returns its index. */
export function addStop(gradient: GradientValue, position: number): [GradientValue, number] {
  const nearest = gradient.stops.reduce((best, stop) =>
    Math.abs(stop.position - position) < Math.abs(best.position - position) ? stop : best,
  )
  return moveStop(
    { ...gradient, stops: [...gradient.stops, nearest] },
    gradient.stops.length,
    position,
  )
}

export const removeStop = (gradient: GradientValue, index: number): GradientValue => ({
  ...gradient,
  stops: gradient.stops.filter((_, i) => i !== index),
})
