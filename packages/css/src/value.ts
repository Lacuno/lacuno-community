import type { AssetRef, CssValue, Document } from '@lacuno/schema'
import { designTokenCssName } from '@lacuno/schema'

export type ValueContext = {
  designTokenName: (id: string) => string | undefined
  assetUrl: (id: string) => string | undefined
}

export function contextFromDocument(
  doc: Document,
  assetUrl?: (asset: AssetRef) => string,
): ValueContext {
  return {
    designTokenName: (id) => doc.designTokens[id]?.name,
    assetUrl: (id) => {
      const asset = doc.assets[id]
      return asset && assetUrl ? assetUrl(asset) : undefined
    },
  }
}

function formatNumber(n: number): string {
  // Up to 4 decimals, no trailing zeros, no "-0".
  const s = Number(n.toFixed(4)).toString()
  return s === '-0' ? '0' : s
}

/** Serialize a typed value to exactly one CSS string. Deterministic. */
export function serializeValue(value: CssValue, ctx: ValueContext): string {
  switch (value.type) {
    case 'unit': {
      const n = formatNumber(value.value)
      if (value.unit === 'number') return n
      // Unitless zero is valid for lengths but not for time, angle, flex or percentage.
      if (n === '0' && !['fr', 'deg', 'turn', 'ms', 's', '%'].includes(value.unit)) return '0'
      return `${n}${value.unit}`
    }
    case 'keyword':
      return value.value
    case 'color':
      return value.value
    case 'raw':
      return value.value
    case 'designToken': {
      const name = ctx.designTokenName(value.ref)
      if (!name) throw new Error(`unknown design token ${value.ref}`)
      return `var(${designTokenCssName(name)})`
    }
    case 'image': {
      const url = ctx.assetUrl(value.asset)
      if (!url) throw new Error(`unknown asset ${value.asset}`)
      return `url("${url}")`
    }
    case 'gradient': {
      const stops = value.stops.map(
        (stop) => `${serializeValue(stop.color, ctx)} ${formatNumber(stop.position)}%`,
      )
      if (value.kind === 'radial') {
        // Defaults are left out, so a gradient without shape or centre compiles as it always did.
        const { shape, at } = value
        const centre =
          at && (at.x !== 50 || at.y !== 50) && `at ${formatNumber(at.x)}% ${formatNumber(at.y)}%`
        const head = [shape === 'circle' && 'circle', centre].filter(Boolean).join(' ')
        return `radial-gradient(${[head, ...stops].filter(Boolean).join(', ')})`
      }
      return `linear-gradient(${formatNumber(value.angle ?? 180)}deg, ${stops.join(', ')})`
    }
    case 'list':
      return value.values.map((v) => serializeValue(v, ctx)).join(value.separator)
    case 'fn':
      return `${value.name}(${value.args.map((a) => serializeValue(a, ctx)).join(', ')})`
  }
}
