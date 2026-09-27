import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('clears the selection on a click in the empty canvas space, not on panel controls', async () => {
  const { page, canvas } = await editor()
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  const selectedCount = () => canvas.locator('[data-lacuno-selected]').count()
  const emptyInspector = () => page.locator('.page-inspector').count()
  // The workspace's left padding is empty canvas space next to the iframe.
  const clickBackground = async () => {
    const box = (await page.locator('.canvas-workspace').boundingBox())!
    await page.mouse.click(box.x + 10, box.y + box.height / 2)
  }

  await cta.click()
  await expect.poll(selectedCount).toBe(1)
  await expect.poll(emptyInspector).toBe(0)
  await clickBackground()
  await expect.poll(selectedCount).toBe(0)
  await expect.poll(emptyInspector).toBeGreaterThan(0)

  // Panel controls keep the selection.
  await cta.click()
  await expect.poll(selectedCount).toBe(1)
  await page.getByRole('button', { name: 'Tablet', exact: true }).click()
  await expect.poll(() => page.locator('.canvas-toolbar .muted').textContent()).toBe('768px')
  await expect.poll(selectedCount).toBe(1)
  await expect.poll(emptyInspector).toBe(0)

  // A click away from the inline text editor commits the typed text, then deselects.
  await cta.dblclick()
  const editable = canvas.getByLabel('Canvas text editor')
  await editable.waitFor()
  await editable.press('End')
  await editable.pressSequentially(' now')
  await clickBackground()
  await expect.poll(selectedCount).toBe(0)
  await expect.poll(() => editable.count()).toBe(0)
  await expect.poll(() => cta.textContent()).toMatch(/ now$/)
}, 60000)
