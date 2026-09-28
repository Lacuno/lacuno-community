import type { Locator, Page } from 'playwright'
import { expect, it } from 'vitest'
import { editor } from './harness.js'

/** A right click held for a moment, as a person makes it; the menu must outlive the release. */
async function rightClick(page: Page, target: Locator) {
  const box = (await target.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + box.height / 2)
  await page.mouse.down({ button: 'right' })
  await page.waitForTimeout(150)
  await page.mouse.up({ button: 'right' })
  await page.waitForTimeout(150)
}

it('fits the pages panel at its narrowest and opens one page menu by right click or its button', async () => {
  const { page, api, siteId, document: site } = await editor({ width: 1100, height: 800 })
  await api(`/api/sites/${siteId}/document/apply`, {
    expectedRevision: (await site()).revision,
    operations: [
      {
        type: 'page.create',
        id: 'p-terms',
        name: 'Terms of Service',
        path: '/terms-of-service',
        root: { id: 'n-terms', type: 'element', tag: 'main', classes: [], children: [] },
      },
    ],
  })
  await page.reload()
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  const panel = page.locator('.sidebar-content')
  await panel.locator('.page-row').first().waitFor()

  // Nothing is cut off: no sideways scrolling, site settings in view, every path readable.
  expect(await panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0)
  const settings = (await page.getByRole('button', { name: 'Site settings' }).boundingBox())!
  const edge = (await panel.boundingBox())!
  expect(settings.x + settings.width).toBeLessThanOrEqual(edge.x + edge.width)
  expect(
    await panel
      .locator('.page-path')
      .evaluateAll((paths) => paths.filter((path) => path.scrollWidth > path.clientWidth).length),
  ).toBe(0)
  expect(
    await panel.locator('.page-link', { hasText: 'Terms of Service' }).getAttribute('title'),
  ).toBe('Terms of Service\n/terms-of-service')

  // A right click opens the menu at the pointer, and it stays open after the button is released.
  const about = panel.locator('.page-link', { hasText: 'About' })
  const menu = page.getByRole('menu')
  await rightClick(page, about)
  await expect.poll(() => menu.isVisible()).toBe(true)
  const items = await menu.getByRole('menuitem').allTextContents()
  expect(items).toEqual(['Open', 'Page settings', 'Duplicate', 'Delete…'])
  const box = (await menu.boundingBox())!
  const aboutBox = (await about.boundingBox())!
  expect(Math.abs(box.x - (aboutBox.x + 20))).toBeLessThanOrEqual(1)

  // Escape closes it and hands the focus back.
  await page.keyboard.press('Escape')
  await expect.poll(() => menu.count()).toBe(0)
  expect(await about.evaluate((element) => element === document.activeElement)).toBe(true)

  // A press elsewhere closes it too.
  await rightClick(page, about)
  await page.locator('.panel-title').first().click()
  await expect.poll(() => menu.count()).toBe(0)

  // The ••• button opens the same menu, driven by the keyboard.
  const trigger = page.getByRole('button', { name: 'Actions for About', exact: true })
  await trigger.click()
  expect(await menu.getByRole('menuitem').allTextContents()).toEqual(items)
  expect(await trigger.getAttribute('aria-expanded')).toBe('true')
  await trigger.click()
  await expect.poll(() => menu.count()).toBe(0)
  await trigger.click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect.poll(() => page.locator('.page-link.active').textContent()).toContain('About copy')

  // Delete asks first; the home page cannot be deleted.
  await rightClick(page, panel.locator('.page-link', { hasText: 'Home' }))
  expect(await menu.getByRole('menuitem', { name: 'Delete…' }).isDisabled()).toBe(true)
  await page.keyboard.press('Escape')
  await rightClick(page, panel.locator('.page-link', { hasText: 'About copy' }))
  await menu.getByRole('menuitem', { name: 'Delete…' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete page' })
  await confirm.getByRole('button', { name: 'Delete page' }).click()
  await expect.poll(() => panel.locator('.page-link', { hasText: 'About copy' }).count()).toBe(0)
})

it('keeps the layer menu open after a right click and offers the element actions', async () => {
  const { page } = await editor()
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  const layer = page.locator('.layer').nth(2)
  await rightClick(page, layer)
  const menu = page.getByRole('menu', { name: 'Layer actions' })
  await expect.poll(() => menu.isVisible()).toBe(true)
  expect(await menu.getByRole('menuitem').allTextContents()).toEqual([
    'Element actions…',
    'Rename',
    'Duplicate',
    'Delete',
  ])
  await page.keyboard.press('Escape')
  await expect.poll(() => menu.count()).toBe(0)
  await rightClick(page, layer)
  await menu.getByRole('menuitem', { name: 'Element actions…' }).click()
  await expect.poll(() => page.locator('.element-actions-popover:popover-open').count()).toBe(1)
})
