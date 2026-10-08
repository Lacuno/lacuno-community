import { expect, it } from 'vitest'
import { clippedFocusRings, editor, openFormatting } from './harness.js'

it('aligns grid children on independent axes, keeps the menu open, and reflects the current position', async () => {
  const { page, canvas, saved, document } = await editor({ width: 1200, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const child = canvas.locator('[data-lacuno-node="n-home-choice-hosted"]')
  const parent = canvas.locator('[data-lacuno-node="n-home-choice-grid"]')
  await child.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await child.dispatchEvent('click')
  const chip = canvas.getByRole('button', { name: 'Align', exact: true })
  await chip.click()
  const menu = canvas.getByRole('dialog', { name: 'Align within parent' })
  const before = (await document()).styles
  await menu.getByRole('button', { name: 'Horizontal: Right', exact: true }).click()
  await saved()
  await expect.poll(() => menu.isVisible()).toBe(true)
  expect(await child.evaluate((el) => getComputedStyle(el).justifySelf)).toBe('end')
  await menu.getByRole('button', { name: 'Vertical: Bottom', exact: true }).click()
  await saved()
  expect(
    await child.evaluate((el) => [
      getComputedStyle(el).justifySelf,
      getComputedStyle(el).alignSelf,
    ]),
  ).toEqual(['end', 'end'])
  await expect
    .poll(() =>
      menu.getByRole('button', { name: 'Horizontal: Right' }).getAttribute('aria-pressed'),
    )
    .toBe('true')
  await expect
    .poll(() => menu.getByRole('button', { name: 'Vertical: Bottom' }).getAttribute('aria-pressed'))
    .toBe('true')
  expect(await menu.getByRole('button', { name: 'Distribute siblings' }).count()).toBe(0)
  expect(await clippedFocusRings(page, '.align-menu', canvas)).toEqual([])
  const anchor = (await chip.boundingBox())!
  const popup = (await menu.boundingBox())!
  const frame = (await page.locator('iframe[title="Site canvas"]').boundingBox())!
  expect(popup.x).toBeGreaterThanOrEqual(frame.x)
  expect(popup.x + popup.width).toBeLessThanOrEqual(frame.x + frame.width)
  expect(popup.y).toBeGreaterThanOrEqual(frame.y)
  expect(popup.y + popup.height).toBeLessThanOrEqual(frame.y + frame.height)
  expect(popup.x).toBeLessThanOrEqual(anchor.x + 1)
  await page.keyboard.press('Escape')
  await expect.poll(() => chip.getAttribute('aria-expanded')).toBe('false')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  expect(await child.evaluate((el) => getComputedStyle(el).justifySelf)).toBe('end')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  expect((await document()).styles).toEqual(before)

  // Distributing siblings is a separately named action on a flex parent.
  await parent.dispatchEvent('click')
  await openFormatting(page, 'Layout')
  await page.getByRole('button', { name: 'Row layout', exact: true }).click()
  await saved()
  await child.dispatchEvent('click')
  await chip.click()
  await menu.getByRole('button', { name: 'Distribute siblings' }).click()
  await saved()
  expect(await parent.evaluate((el) => getComputedStyle(el).justifyContent)).toBe('space-between')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  expect(await parent.evaluate((el) => getComputedStyle(el).justifyContent)).not.toBe(
    'space-between',
  )
  expect(errors).toEqual([])
}, 60_000)

it('offers only horizontal controls in a block parent and hides them while editing text', async () => {
  const { page, canvas, saved } = await editor()
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.click()
  const chip = canvas.getByRole('button', { name: 'Align', exact: true })
  await chip.click()
  const menu = canvas.getByRole('dialog', { name: 'Align within parent' })
  expect(await menu.getByRole('group', { name: 'Horizontal alignment' }).count()).toBe(1)
  expect(await menu.getByRole('group', { name: 'Vertical alignment' }).count()).toBe(0)
  await menu.getByRole('button', { name: 'Horizontal: Center', exact: true }).click()
  await saved()
  await expect
    .poll(() =>
      cta.evaluate((el) =>
        ['margin-left', 'margin-right'].map((p) => String(el.computedStyleMap().get(p))),
      ),
    )
    .toEqual(['auto', 'auto'])
  await menu.getByRole('button', { name: 'Close alignment controls' }).click()
  await expect.poll(() => chip.getAttribute('aria-expanded')).toBe('false')
  await cta.dblclick()
  await canvas.getByLabel('Canvas text editor').waitFor()
  await expect.poll(() => chip.count()).toBe(0)
  await page.keyboard.press('Escape')
}, 60_000)
