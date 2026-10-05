import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('reorders pages by dragging and keeps the order after a reload', async () => {
  const { page, document, saved } = await editor()
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  const names = () =>
    page
      .locator('.page-list .page-name')
      .evaluateAll((items) => items.map((item) => item.firstChild?.textContent))
  const before = await names()
  const last = before.at(-1)!
  await page
    .locator('.page-row')
    .last()
    .dragTo(page.locator('.page-row').first(), { targetPosition: { x: 20, y: 2 } })
  await saved()
  const after = [last, ...before.slice(0, -1)]
  await expect.poll(names).toEqual(after)
  const pages = Object.values((await document()).pages)
  expect(pages.find((item) => item.name === last)?.order).toBe(0)

  await page.reload()
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await expect.poll(names).toEqual(after)
})
