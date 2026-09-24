import type { CssValue } from '@miralo/schema'

export type Swatch = { id: string; name: string; value: string }
export type Hsl = { h: number; s: number; l: number }

/** What a canvas control tells the editor: a preview frame, the final value(s), or a token to create. */
export type StyleEdit =
  | { property: string; value: CssValue; phase: 'drag' | 'commit' }
  | { changes: Record<string, CssValue>; phase: 'drag' | 'commit' }
  | { property: string; token: { name: string; value: string } }

/** The red, green and blue (0-255) of a `#rrggbb` or `rgb()` colour. */
export function parseRgb(text: string): number[] | undefined {
  const hex = text.match(/^#([\da-f]{6})/i)
  const rgb = text.match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/)
  return hex
    ? [0, 2, 4].map((i) => Number.parseInt(hex[1]!.slice(i, i + 2), 16))
    : rgb?.slice(1, 4).map(Number)
}

export const rgbHex = (parts: number[]) =>
  `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`

export function parseColor(text: string): Hsl | undefined {
  const parts = parseRgb(text)
  if (!parts) return undefined
  const [r, g, b] = parts.map((part) => part / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (!d) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / d + 2) * 60
        : ((r - g) / d + 4) * 60
  return { h, s, l }
}

function toRgb({ h, s, l }: Hsl): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return [r, g, b].map((part) => Math.round((part + m) * 255)) as [number, number, number]
}

export const toHex = (hsl: Hsl) => rgbHex(toRgb(hsl))

/** The project colour within a short distance of `hsl`, so a drag can settle on the design system. */
export function nearestSwatch(hsl: Hsl, swatches: Swatch[]): Swatch | undefined {
  const [r, g, b] = toRgb(hsl)
  let best: { swatch: Swatch; distance: number } | undefined
  for (const swatch of swatches) {
    const other = parseColor(swatch.value)
    if (!other) continue
    const [r2, g2, b2] = toRgb(other)
    const distance = Math.hypot(r - r2, g - g2, b - b2)
    if (distance < 24 && (!best || distance < best.distance)) best = { swatch, distance }
  }
  return best?.swatch
}

export const WHEEL_SIZE = 160

/**
 * A CSS wheel: hue by angle, lightness by radius (black centre to white rim). The saturation
 * layer greys it toward the middle so the disc matches the picked saturation.
 */
export function wheelBackground(saturation: number): string {
  const grey = 1 - saturation
  return [
    'radial-gradient(circle, transparent 48%, #fff 100%)',
    `radial-gradient(circle, rgba(128,128,128,${grey}) 0%, rgba(128,128,128,${grey}) 100%)`,
    'radial-gradient(circle, #000 0%, transparent 48%)',
    'conic-gradient(from 90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
  ].join(', ')
}

/** The hue and lightness under a pointer position on the wheel element. */
export function wheelColor(wheel: HTMLElement, clientX: number, clientY: number, s: number): Hsl {
  const rect = wheel.getBoundingClientRect()
  const radius = rect.width / 2
  const dx = clientX - rect.left - radius
  const dy = clientY - rect.top - radius
  return {
    h: (Math.atan2(dy, dx) * (180 / Math.PI) + 360) % 360,
    s,
    l: Math.min(1, Math.hypot(dx, dy) / radius),
  }
}

/** Where the thumb sits on the wheel for a colour, as a fraction of the wheel from top-left. */
export function thumbPosition({ h, l }: Hsl): { x: number; y: number } {
  const radius = Math.min(l, 1) * 0.5
  return {
    x: 0.5 + Math.cos((h * Math.PI) / 180) * radius,
    y: 0.5 + Math.sin((h * Math.PI) / 180) * radius,
  }
}
