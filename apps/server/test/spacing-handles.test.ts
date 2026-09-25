import { expect, it } from 'vitest'
import { drag, editor } from './harness.js'

it('drags on-canvas padding and margin handles: symmetric, Alt single-side, one undo step', async () => {
  const { page, canvas, saved } = await editor({ width: 1200, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let writes = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/document/apply')) writes++
  })
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  await cta.click()

  const value = (property: string) =>
    cta.evaluate(
      (element, p) => Number.parseFloat(getComputedStyle(element).getPropertyValue(p)),
      property,
    )
  // Read two sides in one snapshot so a symmetric comparison can't catch them mid-commit.
  const pair = (a: string, b: string) =>
    cta.evaluate(
      (element, props) => {
        const style = getComputedStyle(element)
        return props.map((p) => Number.parseFloat(style.getPropertyValue(p)))
      },
      [a, b],
    )
  // Iframe transform scale: the pointer maps to CSS px through it, so a screen drag of d moves
  // the edge d/zoom CSS px (the handle math uses the iframe's own coordinates, no division).
  const zoom = await page
    .locator('iframe[title="Site canvas"]')
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
  expect(zoom).toBeLessThan(1)

  // Spacing nubs show in spacing mode, switched on by the chip in the selection's top bar.
  const spacingChip = canvas.getByRole('button', { name: 'Spacing', exact: true })
  await spacingChip.click()
  await expect.poll(() => spacingChip.getAttribute('aria-pressed')).toBe('true')
  // Symmetric padding: dragging the top handle up grows padding-top AND padding-bottom equally.
  const [padTop0, padBottom0] = await pair('padding-top', 'padding-bottom')
  const before = writes
  await drag(page, '.handle.padding.top', { dy: -60 })
  // Wait for the one commit to settle before comparing, so both sides are read in the same state.
  await saved()
  await expect
    .poll(async () => (await pair('padding-top', 'padding-bottom'))[0]!)
    .toBeGreaterThan(padTop0! + 40)
  const [padTop, padBottom] = await pair('padding-top', 'padding-bottom')
  expect(padBottom! - padBottom0!).toBeCloseTo(padTop! - padTop0!, 0)
  // The drag tracks the pointer: ~60 screen px up is ~60/zoom CSS px of extra padding.
  expect(padTop! - padTop0!).toBeGreaterThan((60 / zoom) * 0.6)
  expect(padTop! - padTop0!).toBeLessThan((60 / zoom) * 1.4)
  // One commit = one write and one undo step that restores BOTH sides.
  expect(writes).toBe(before + 1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => value('padding-top')).toBeCloseTo(padTop0!, 0)
  await expect.poll(() => value('padding-bottom')).toBeCloseTo(padBottom0!, 0)

  // Alt drag moves only the dragged side: left grows, right is untouched.
  const padLeft0 = await value('padding-left')
  const padRight0 = await value('padding-right')
  await drag(page, '.handle.padding.left', { dx: -60 }, 1)
  await expect.poll(() => value('padding-left')).toBeGreaterThan(padLeft0 + 40)
  expect(await value('padding-right')).toBeCloseTo(padRight0, 0)
  await saved()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => value('padding-left')).toBeCloseTo(padLeft0, 0)

  // A margin handle writes margin-* the same way, symmetric by default.
  const [marginTop0, marginBottom0] = await pair('margin-top', 'margin-bottom')
  await drag(page, '.handle.margin.top', { dy: -50 })
  await saved()
  await expect
    .poll(async () => (await pair('margin-top', 'margin-bottom'))[0]!)
    .toBeGreaterThan(marginTop0! + 30)
  const [marginTop, marginBottom] = await pair('margin-top', 'margin-bottom')
  expect(marginBottom! - marginBottom0!).toBeCloseTo(marginTop! - marginTop0!, 0)

  expect(errors).toEqual([])
}, 60000)
