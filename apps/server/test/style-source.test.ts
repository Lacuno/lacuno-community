import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('names where each style field gets its value', async () => {
  const { page, canvas, saved } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const ribbon = page.locator('.ribbon-controls')
  const line = (property: string) => ribbon.locator(`.source[data-source="${property}"]`).first()
  const source = (property: string) => line(property).textContent()
  const tab = (name: string) => page.getByRole('button', { name, exact: true }).click()

  // The hero heading inherits its font from the page root's site class, through a token.
  const heading = canvas.locator('[data-miralo-node="n-home-title"]')
  await heading.waitFor()
  await heading.click()
  await expect.poll(() => source('font-family')).toBe('body · inherited')
  // Following an inherited line selects the element that sets the value: the page root, whose
  // own line names its class.
  expect(await line('font-family').getAttribute('aria-label')).toBe('Go to Body')
  await line('font-family').click()
  await expect.poll(() => source('font-family')).toMatch(/^body · class /)
  await heading.click()
  await expect.poll(() => source('font-family')).toBe('body · inherited')
  await ribbon.getByLabel('Font', { exact: true }).selectOption('system-ui, sans-serif')
  await expect.poll(() => source('font-family')).toBe('local')
  await saved()

  // The CTA's padding comes from the shared button class until it is set here.
  const cta = canvas.locator('[data-miralo-node="n-home-cta"]')
  await cta.click()
  await tab('Layout')
  await expect.poll(() => source('padding-top')).toMatch(/^[\d.]+px · class button$/)
  // The Layout tab fits a 1500px window with the design tokens in view.
  const ribbonBody = page.locator('.ribbon-body')
  expect(await ribbonBody.evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(0)
  const swatches = await page.locator('.ribbon-swatches').boundingBox()
  expect(swatches!.x + swatches!.width).toBeLessThanOrEqual(1500)
  // The class line highlights the class in the inspector's Classes section.
  expect(await line('padding-top').getAttribute('aria-label')).toBe('Go to class button')
  await line('padding-top').click()
  await expect
    .poll(() => page.locator('.class-manager [data-highlight] summary').textContent())
    .toMatch(/^button /)
  expect(await page.locator('.advanced-classes').getAttribute('open')).not.toBeNull()
  await expect
    .poll(() =>
      ribbon
        .getByRole('button', { name: 'Link inside spacing top and bottom', exact: true })
        .getAttribute('aria-pressed'),
    )
    .toBe('true')
  await ribbon.getByLabel('Inside spacing top', { exact: true }).fill('30')
  await expect.poll(() => source('padding-top')).toMatch(/ · local$/)
  await saved()
  await tab('Tablet')
  await expect.poll(() => source('padding-top')).toMatch(/^[\d.]+px · local, Desktop$/)
  await tab('Desktop')

  // A preset made from the link supplies its background, still through the accent token.
  await tab('Home')
  await page.getByRole('button', { name: 'Preset actions', exact: true }).click()
  await page.getByRole('button', { name: 'Create preset from selection', exact: true }).click()
  await page.getByLabel('Preset name', { exact: true }).fill('Call to action')
  await page.getByRole('button', { name: 'Create preset', exact: true }).click()
  await saved()
  await tab('Appearance')
  await expect.poll(() => source('background-color')).toBe('accent · preset Call to action')
  // The preset line opens the preset manager on it.
  expect(await line('background-color').getAttribute('aria-label')).toBe(
    'Go to preset Call to action',
  )
  await line('background-color').click()
  await expect
    .poll(() =>
      page
        .locator('.preset-actions-popover')
        .evaluate((popover) => popover.matches(':popover-open')),
    )
    .toBe(true)
  expect(
    await ribbon
      .getByLabel('Preset', { exact: true })
      .evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.text),
  ).toBe('Call to action')
  await page.keyboard.press('Escape')

  // Binding a side to a spacing token names the token.
  await tab('Layout')
  await ribbon.getByRole('button', { name: 'Use a token for Inside spacing top' }).click()
  await ribbon.getByRole('menuitemradio', { name: /^md/ }).click()
  await expect.poll(() => source('padding-top')).toBe('md · local')
  await saved()
  // The token line opens the design tokens on Spacing with md selected.
  expect(await line('padding-top').getAttribute('aria-label')).toBe('Go to token md')
  await line('padding-top').click()
  const tokens = page.getByRole('dialog', { name: 'Design tokens' })
  await expect
    .poll(() =>
      tokens.getByRole('button', { name: 'Spacing', exact: true }).getAttribute('aria-pressed'),
    )
    .toBe('true')
  expect(await tokens.locator('.palette-item.active strong').textContent()).toBe('md')
  expect(errors).toEqual([])
}, 120_000)
