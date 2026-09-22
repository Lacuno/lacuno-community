import { expect, it } from 'vitest'
import { nearestSwatch, parseColor, toHex } from '../src/colorWheel.js'

it('round-trips colours between rgb text, hsl and hex', () => {
  for (const hex of ['#ff0000', '#00ff80', '#123456', '#ffffff', '#000000', '#808080'])
    expect(toHex(parseColor(hex)!)).toBe(hex)
  expect(toHex(parseColor('rgb(255, 128, 0)')!)).toBe('#ff8000')
  expect(parseColor('transparent')).toBeUndefined()
})

it('snaps to a project colour only when the drag lands close to it', () => {
  const swatches = [
    { id: 'dt-brand', name: 'Brand', value: '#6434d9' },
    { id: 'dt-ink', name: 'Ink', value: '#1f1533' },
  ]
  expect(nearestSwatch(parseColor('#6636d8')!, swatches)?.id).toBe('dt-brand')
  expect(nearestSwatch(parseColor('#ff0000')!, swatches)).toBeUndefined()
})
