import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('edits a hover state in the canvas, publishes its rule and undoes it', async () => {
  const { server, page, canvas, publish, saved } = await editor()
  const background = (id: string) =>
    canvas
      .locator(`[data-freeflow-node="${id}"]`)
      .evaluate((element) => getComputedStyle(element).backgroundColor)
  const cta = canvas.locator('[data-freeflow-node="n-home-cta"]')
  await cta.waitFor()
  const restingCta = await background('n-home-cta')
  const restingLead = await background('n-home-lead')
  await cta.click()
  // The state chip on the selection label opens a menu; the pick stays active for every edit.
  const pickState = async (name: string) => {
    await canvas.getByRole('button', { name: /^State: / }).click()
    await canvas.getByRole('menuitemradio', { name }).click()
  }

  await pickState('Hover')
  await expect.poll(() => canvas.getByRole('button', { name: 'State: Hover' }).count()).toBe(1)
  await expect
    .poll(() => page.getByTitle('Every change here applies to this state').textContent())
    .toBe('Hover')
  await expect.poll(() => cta.getAttribute('data-ff-state')).toBe('hover')
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByLabel('Background color', { exact: true }).fill('#ff0000')
  await saved()
  await expect.poll(() => background('n-home-cta')).toBe('rgb(255, 0, 0)')
  expect(await background('n-home-lead')).toBe(restingLead)

  // Back to None: the forced attribute goes, and with it the hover paint.
  await pickState('Default')
  await expect.poll(() => cta.getAttribute('data-ff-state')).toBeNull()
  await expect.poll(() => background('n-home-cta')).toBe(restingCta)

  const live = await publish()
  const html = await (await server.published!.request(live)).text()
  const stylesheet = html.match(/href="(\/(?:_astro|assets)\/[^" ]+\.css)"/)?.[1]
  expect(stylesheet).toBeTruthy()
  const css = await (await server.published!.request(live + stylesheet)).text()
  // The build minifies colours, so #ff0000 may arrive as `red`.
  expect(css).toMatch(/\.ff-[^{]*:hover\{background-color:(red|#ff0000)\}/i)
  expect(css).not.toContain('data-ff-state')

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  await pickState('Hover')
  await expect.poll(() => background('n-home-cta')).toBe(restingCta)
}, 120_000)
