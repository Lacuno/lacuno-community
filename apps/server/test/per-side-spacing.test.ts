import { expect, it } from 'vitest'
import { editor, openFormatting, press } from './harness.js'

it('binds per-side spacing inputs to the longhands and the handles, with a chain per pair of sides', async () => {
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
  await openFormatting(page, 'Spacing & shape')

  const inspector = page.locator('aside.inspector')
  // Read the four computed sides in one snapshot so a comparison can't catch them mid-commit.
  const padding = () =>
    cta.evaluate((element) => {
      const style = getComputedStyle(element)
      return (['top', 'right', 'bottom', 'left'] as const).map((side) =>
        Number.parseFloat(style.getPropertyValue(`padding-${side}`)),
      )
    })
  const initial = await padding()

  // The button's padding is symmetric per pair, so both chains start pressed: editing one side
  // moves the opposite side too, in a single write / undo step.
  const chain = (pair: string) =>
    inspector.getByRole('button', { name: `Link inside spacing ${pair}`, exact: true })
  for (const pair of ['top and bottom', 'left and right'])
    await expect.poll(() => chain(pair).getAttribute('aria-pressed')).toBe('true')
  for (const [side, value, expected] of [
    ['top', '30', [30, initial[1], 30, initial[3]]],
    ['left', '40', [initial[0], 40, initial[2], 40]],
  ] as const) {
    const before = writes
    await inspector.getByLabel(`Inside spacing ${side}`, { exact: true }).fill(value)
    await expect.poll(padding).toEqual(expected)
    await saved()
    expect(writes).toBe(before + 1)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(padding).toEqual(initial)
    await saved()
  }

  // Chain off: editing one side moves only that side.
  await chain('left and right').click()
  await inspector.getByLabel('Inside spacing left', { exact: true }).fill('40')
  await expect.poll(padding).toEqual([initial[0], initial[1], initial[2], 40])
  await saved()

  // Any length keeps its unit: a rem side reads back as rem, not as a bare pixel count.
  const topInput = inspector.getByLabel('Inside spacing top', { exact: true })
  await topInput.fill('1.5rem')
  await expect.poll(padding).toEqual([24, initial[1], 24, 40])
  await saved()
  await expect.poll(() => topInput.inputValue()).toBe('1.5rem')

  // Dragging a padding handle updates the matching side input live, before the commit lands.
  const zoom = await page
    .locator('iframe[title="Site canvas"]')
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
  // Spacing nubs show in spacing mode, switched on by the chip in the selection's top bar.
  const spacingChip = canvas.getByRole('button', { name: 'Spacing', exact: true })
  await spacingChip.click()
  await expect.poll(() => spacingChip.getAttribute('aria-pressed')).toBe('true')
  // Ctrl keeps the drag off the template's spacing tokens, so the input shows a number.
  const release = await press(page, '.handle.padding.top', { dy: -50 }, 2)
  // The input tracks the draft while the pointer is still down (autosave paused).
  await expect
    .poll(() => topInput.inputValue().then(Number.parseFloat))
    .toBeGreaterThan((50 / zoom) * 0.6)
  await release()
  await saved()
  expect((await padding())[0]!).toBeGreaterThan((50 / zoom) * 0.6)

  expect(errors).toEqual([])
}, 60000)
