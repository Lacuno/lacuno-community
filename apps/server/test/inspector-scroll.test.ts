import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('keeps the inspector scroll position across a spacing edit', async () => {
  const { page, canvas, saved } = await editor({ width: 1200, height: 700 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const cta = canvas.locator('[data-freeflow-node="n-home-cta"]')
  await cta.waitFor()
  await cta.click()

  // Scroll the inspector down to the spacing inputs.
  const inspector = page.locator('aside.inspector')
  const scrollTop = () => inspector.evaluate((element) => element.scrollTop)
  const input = inspector.getByLabel('Inside spacing top', { exact: true })
  await input.scrollIntoViewIfNeeded()
  const scrolled = await scrollTop()
  expect(scrolled).toBeGreaterThan(0)

  await input.fill('30')
  await saved()
  expect(await scrollTop()).toBe(scrolled)

  // A padding handle drag commits the same edit from the canvas.
  // Spacing nubs show in spacing mode, switched on by the chip in the selection's top bar.
  const spacingChip = canvas.getByRole('button', { name: 'Spacing', exact: true })
  await spacingChip.click()
  await expect.poll(() => spacingChip.getAttribute('aria-pressed')).toBe('true')
  const nub = canvas.locator('.handle.padding.top')
  await nub.waitFor()
  const box = (await nub.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30, { steps: 10 })
  await page.mouse.up()
  await expect.poll(() => input.inputValue()).not.toBe('30')
  await saved()
  expect(await scrollTop()).toBe(scrolled)

  expect(errors).toEqual([])
}, 60000)
