import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('inserts a button, points it at a page and follows the page through a path change', async () => {
  const { server, page, canvas, publish, saved } = await editor()
  await canvas.locator('[data-lacuno-node="n-home-cta"]').waitFor()

  // A button from the palette is an `a` pointing at the page it was added to.
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Button', exact: true }).click()
  await page.getByRole('button', { name: 'Insert element', exact: true }).click()
  await saved()
  const button = canvas.getByRole('link', { name: 'Button', exact: true })
  await expect.poll(() => button.getAttribute('href')).toBe('/')

  // An element with an href is focusable, so the state menu offers Focus.
  await button.click()
  await canvas.getByRole('button', { name: /^State: / }).click()
  await expect
    .poll(() => canvas.getByRole('menuitemradio', { name: /^Focus While it has focus/ }).count())
    .toBe(1)
  await page.keyboard.press('Escape')

  // The inspector's link target writes a page reference, not a path.
  const target = page.locator('.link-target-row')
  const destination = page.locator('.link-target-row > strong')
  await expect.poll(() => destination.textContent()).toBe('Home')
  await target.getByRole('button', { name: 'Change', exact: true }).click()
  await target.getByLabel('Link to page', { exact: true }).selectOption({ label: 'About' })
  await target.getByRole('button', { name: 'Apply link', exact: true }).click()
  await saved()
  await expect.poll(() => destination.textContent()).toBe('About')
  await expect.poll(() => button.getAttribute('href')).toBe('/about')

  // The published home page's HTML.
  const home = async () => (await server.published!.request(`${await publish()}/`)).text()
  // The template's own static links pin a path; only the inserted button holds a page binding.
  expect(await home()).toMatch(/<a [^>]*href="\/about"[^>]*>Button<\/a>/)

  // Renaming the path moves the link with it; the binding never held the old path.
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: 'Settings for About', exact: true }).click()
  await page.getByLabel('URL path', { exact: true }).fill('/company')
  await page.getByRole('button', { name: 'Save page', exact: true }).click()
  await saved()
  await expect.poll(() => button.getAttribute('href')).toBe('/company')
  const republished = await home()
  expect(republished).toMatch(/<a [^>]*href="\/company"[^>]*>Button<\/a>/)
  expect(republished).not.toMatch(/<a [^>]*href="\/about"[^>]*>Button<\/a>/)
}, 240_000)
