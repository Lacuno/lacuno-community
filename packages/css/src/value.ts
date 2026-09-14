import type { CssValue, Document } from '@freeflow/schema'
import { tokenCssName } from '@freeflow/schema'

export type ValueContext = {
  tokenName: (id: string) => string | undefined
  assetUrl: (id: string) => string | undefined
}

export function contextFromDocument(
  doc: Document,
  assetUrl: (id: string) => string | undefined = () => undefined,
): ValueContext {
  return {
    tokenName: (id) => doc.tokens[id]?.name,
    assetUrl,
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
    case 'token': {
      const name = ctx.tokenName(value.ref)
      if (!name) throw new Error(`unknown token ${value.ref}`)
      return `var(${tokenCssName(name)})`
    }
    case 'image': {
      const url = ctx.assetUrl(value.asset)
      if (!url) throw new Error(`unknown asset ${value.asset}`)
      return `url("${url}")`
    }
    case 'list':
      return value.values.map((v) => serializeValue(v, ctx)).join(value.separator)
    case 'fn':
      return `${value.name}(${value.args.map((a) => serializeValue(a, ctx)).join(', ')})`
  }
}
