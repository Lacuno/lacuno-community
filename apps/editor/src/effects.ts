export type Tilt = { x: number; y: number }
export function readTilt(value: string): Tilt | undefined {
  if (!value || value === 'none') return { x: 0, y: 0 }
  const match = /^perspective\(800px\) rotateX\((-?[\d.]+)deg\) rotateY\((-?[\d.]+)deg\)$/.exec(
    value,
  )
  return match ? { x: Number(match[1]), y: Number(match[2]) } : undefined
}
export const writeTilt = ({ x, y }: Tilt) => `perspective(800px) rotateX(${x}deg) rotateY(${y}deg)`

export type Shadow = {
  x: number
  y: number
  blur: number
  spread: number
  color: string
  inset: boolean
}
export const defaultShadow: Shadow = {
  x: 0,
  y: 8,
  blur: 24,
  spread: 0,
  color: '#00000026',
  inset: false,
}
export function readShadow(value: string): Shadow | undefined {
  if (!value || value === 'none') return { ...defaultShadow }
  // Only edit the single-shadow form produced by these controls; preserve other CSS verbatim.
  const match = /^(inset )?(-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px (-?[\d.]+)px (.*)$/.exec(value)
  if (!match || /,(?![^()]*\))/.test(match[6]!)) return undefined
  return {
    x: Number(match[2]),
    y: Number(match[3]),
    blur: Number(match[4]),
    spread: Number(match[5]),
    color: match[6]!,
    inset: !!match[1],
  }
}
export const writeShadow = (shadow: Shadow) =>
  `${shadow.inset ? 'inset ' : ''}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${shadow.color}`
