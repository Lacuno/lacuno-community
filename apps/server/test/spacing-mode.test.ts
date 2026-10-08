import { expect, it } from 'vitest'
import { editor, openFormatting, press } from './harness.js'

it('switches spacing mode with the chip: nubs, labelled boxes, sidebar focus, text editing', async () => {
  const { page, canvas, saved } = await editor({ width: 1200, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  await cta.click()

  const chip = canvas.getByRole('button', { name: 'Spacing', exact: true })
  // Rendered at all (a zero-size strip still counts), through the shadow host and handles layer.
  const shown = (selector: string) =>
    canvas.locator(selector).evaluate((element) => element.checkVisibility())
  const strip = (selector: string) =>
    canvas.locator(selector).evaluate((element) => ({
      height: element.getBoundingClientRect().height,
      label: element.textContent,
    }))
  const paddingTop = (element: typeof cta) =>
    element.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingTop))

  // A fresh selection shows its outline, bars and size handles, but no spacing nubs or boxes.
  await expect.poll(() => shown('.handle.size.right')).toBe(true)
  expect(await chip.getAttribute('aria-pressed')).toBe('false')
  expect(await shown('.handle.padding.top')).toBe(false)
  expect(await shown('.handle.margin.top')).toBe(false)
  expect(await shown('.strip.padding.top')).toBe(false)

  // The chip turns on the nubs and the boxes; the top padding strip is as tall as the padding.
  await chip.click()
  await expect.poll(() => chip.getAttribute('aria-pressed')).toBe('true')
  await expect.poll(() => shown('.handle.padding.top')).toBe(true)
  expect(await shown('.handle.margin.left')).toBe(true)
  expect(await shown('.strip.margin.bottom')).toBe(true)
  const top = await paddingTop(cta)
  expect(top).toBeGreaterThan(0)
  await expect
    .poll(async () => Math.abs((await strip('.strip.padding.top')).height - top))
    .toBeLessThan(1)
  expect((await strip('.strip.padding.top')).label).toBe(String(Math.round(top)))

  // The mode survives a colour commit (a morph) and a selection change.
  await canvas.getByRole('button', { name: /^Background color: / }).click()
  await expect.poll(() => canvas.locator('.wheel').count()).toBe(1)
  await canvas.locator('.swatches button').nth(2).click()
  await canvas.getByRole('button', { name: /^Background color: / }).click()
  await saved()
  expect(await chip.getAttribute('aria-pressed')).toBe('true')
  expect(await shown('.strip.padding.top')).toBe(true)
  const title = canvas.locator('[data-lacuno-node="n-home-title"]')
  await title.click()
  await expect.poll(() => title.getAttribute('data-lacuno-selected')).toBe('')
  expect(await chip.getAttribute('aria-pressed')).toBe('true')
  expect(await shown('.strip.margin.bottom')).toBe(true)
  expect(await shown('.handle.padding.top')).toBe(true)
  const titleTop = await paddingTop(title)
  await expect
    .poll(async () => Math.abs((await strip('.strip.padding.top')).height - titleTop))
    .toBeLessThan(1)

  // Dragging the top nub (Ctrl: no token snapping) moves the bottom label live while the readout
  // stands in for the top one; after the commit the top label reads the new padding.
  await cta.click()
  await expect.poll(() => cta.getAttribute('data-lacuno-selected')).toBe('')
  const bottom0 = (await strip('.strip.padding.bottom')).label
  const release = await press(page, '.handle.padding.top', { dy: -20 }, 2)
  await expect.poll(async () => (await strip('.strip.padding.bottom')).label).not.toBe(bottom0)
  expect((await strip('.strip.padding.top')).label).toBe('')
  await release()
  await saved()
  const dragged = await paddingTop(cta)
  expect(dragged).toBeGreaterThan(top + 10)
  await expect
    .poll(async () => (await strip('.strip.padding.top')).label)
    .toBe(String(Math.round(dragged)))

  // A margin pushed to the end reads "auto" instead of the distance it resolves to.
  await canvas.getByRole('button', { name: 'Align', exact: true }).click()
  await canvas.getByRole('button', { name: 'Horizontal: Right', exact: true }).click()
  await saved()
  await expect.poll(async () => (await strip('.strip.margin.left')).label).toBe('auto')
  await canvas.getByRole('button', { name: 'Close alignment controls', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  await expect.poll(async () => (await strip('.strip.margin.left')).label).not.toBe('auto')

  // Chip off: focusing a sidebar spacing input shows the boxes (not the nubs) until it blurs.
  await chip.click()
  await expect.poll(() => shown('.strip.padding.top')).toBe(false)
  expect(await shown('.handle.padding.top')).toBe(false)
  await openFormatting(page, 'Spacing & shape')
  const input = page.locator('aside.inspector').getByLabel('Inside spacing top', { exact: true })
  await input.focus()
  await expect.poll(() => shown('.strip.padding.top')).toBe(true)
  expect(await shown('.handle.padding.top')).toBe(false)
  await input.blur()
  await expect.poll(() => shown('.strip.padding.top')).toBe(false)

  // Inline text editing hides the chip and every handle; leaving it brings them back.
  await chip.click()
  await expect.poll(() => shown('.handle.padding.top')).toBe(true)
  await cta.dblclick()
  await canvas.getByLabel('Canvas text editor').waitFor()
  await expect.poll(() => shown('.spacing')).toBe(false)
  expect(await shown('.handle.padding.top')).toBe(false)
  expect(await shown('.handle.size.right')).toBe(false)
  await page.getByRole('button', { name: 'Cancel text edit', exact: true }).click()
  await expect.poll(() => shown('.spacing')).toBe(true)
  expect(await shown('.handle.padding.top')).toBe(true)

  expect(errors).toEqual([])
}, 60000)
