import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('inserts a menu that opens by popover below Desktop, and holds it open on the canvas while styling', async () => {
  const { context, page, canvas, api, siteId, document, saved } = await editor()
  await canvas.locator('[data-lacuno-node="n-home-cta"]').waitFor()
  const before = await document()

  // One insertion, one undo step: the redo brings back the very same menu.
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.getByRole('button', { name: 'Insert element', exact: true }).click()
  await saved()
  const inserted = await document()
  const shape = ({ nodes, classes, styles }: typeof before) => ({ nodes, classes, styles })
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  expect(shape(await document())).toEqual(shape(before))
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await saved()
  expect(shape(await document())).toEqual(shape(inserted))

  // The canvas at Desktop shows the links in place and hides the button.
  const panel = canvas.locator('nav[popover]')
  const burger = canvas.locator('button[popovertarget]')
  const open = () => panel.evaluate((element) => element.matches(':popover-open'))
  await expect.poll(() => panel.getByText('About').isVisible()).toBe(true)
  expect(await burger.isVisible()).toBe(false)

  // At Mobile the panel waits for its button. A click on the button only selects it; Show open
  // opens the panel, which stays open while a link inside it is selected and recoloured.
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect.poll(() => panel.isVisible()).toBe(false)
  await burger.click()
  expect(await open()).toBe(false)
  await canvas.getByRole('button', { name: 'Show open', exact: true }).click()
  await expect.poll(open).toBe(true)
  const about = panel.getByText('About')
  await expect.poll(() => about.isVisible()).toBe(true)
  await about.click()
  const color = await about.evaluate((element) => getComputedStyle(element).color)
  await canvas.getByRole('button', { name: /^Text color: / }).click()
  await canvas.locator('.swatches button').first().click()
  await saved()
  await expect
    .poll(() => about.evaluate((element) => getComputedStyle(element).color))
    .not.toBe(color)
  expect(await open()).toBe(true)
  await canvas.getByRole('button', { name: 'Hide', exact: true }).click()
  await expect.poll(open).toBe(false)
  expect(await about.isVisible()).toBe(false)

  // The page as published: the button names the panel, which the browser opens and closes.
  const home = Object.values(inserted.pages).find((item) => item.path === '/')!.id
  const { html } = (await (await api(`/api/sites/${siteId}/preview?page=${home}`)).json()) as {
    html: string
  }
  const live = await context.newPage()
  await live.setViewportSize({ width: 390, height: 800 })
  await live.setContent(html)
  const livePanel = live.locator('nav[popover]')
  const liveBurger = live.locator('button[popovertarget]')
  expect(await liveBurger.getAttribute('popovertarget')).toBe(await livePanel.getAttribute('id'))
  expect(await liveBurger.getAttribute('aria-label')).toBe('Menu')
  expect(await livePanel.getAttribute('popover')).toBe('auto')
  expect(await livePanel.getByText('Home').getAttribute('href')).toBe('/')
  expect(await livePanel.isVisible()).toBe(false)
  await liveBurger.click()
  await expect.poll(() => livePanel.getByText('Contact').isVisible()).toBe(true)
  expect(await livePanel.evaluate((element) => getComputedStyle(element).position)).toBe('fixed')
  await live.keyboard.press('Escape')
  await expect.poll(() => livePanel.isVisible()).toBe(false)
  await liveBurger.click()
  await expect.poll(() => livePanel.isVisible()).toBe(true)
  await live.mouse.click(10, 10)
  await expect.poll(() => livePanel.isVisible()).toBe(false)
  await live.setViewportSize({ width: 1280, height: 800 })
  await expect.poll(() => livePanel.getByText('Contact').isVisible()).toBe(true)
  expect(await liveBurger.isVisible()).toBe(false)
}, 60_000)
