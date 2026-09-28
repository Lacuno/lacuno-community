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

const stopList = (doc: Document, gradient: GradientValue) =>
  gradient.stops.map((stop) => `${stopColor(doc, stop)} ${stop.position}%`).join(', ')

/** The stops left to right, as the editor chrome paints them on the stops bar. */
export const stopsBackground = (doc: Document, gradient: GradientValue) =>
  `linear-gradient(90deg, ${stopList(doc, gradient)})`

/**
 * The gradient's fields in the order the document keeps them, so an edit compares equal to the
 * saved value once it lands and the draft settles.
 */
export const schemaOrder = ({
  type,
  kind,
  angle,
  shape,
  at,
  stops,
}: GradientValue): GradientValue => ({
  type,
  kind,
  ...(angle !== undefined && { angle }),
  ...(shape && { shape }),
  ...(at && { at }),
  stops,
})

export const defaultCentre = { x: 50, y: 50 }

/** A radial gradient as the editor chrome paints it behind the centre presets. */
export const radialBackground = (doc: Document, gradient: GradientValue) => {
  const { x, y } = gradient.at ?? defaultCentre
  return `radial-gradient(${gradient.shape ?? 'ellipse'} at ${x}% ${y}%, ${stopList(doc, gradient)})`
}

export const clamp = (percent: number) => Math.round(Math.min(100, Math.max(0, percent)))

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
