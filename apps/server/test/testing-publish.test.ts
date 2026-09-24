import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('publishes to testing, promotes the same build and keeps testing through the next release', async () => {
  const { context, page, canvas } = await editor()
  const heading = canvas.locator('[data-miralo-node="n-home-title"]')

  const dialog = page.locator('.publish-dialog')
  const summary = dialog.locator('.publish-summary')
  const row = (version: number) =>
    dialog
      .locator('.release-list > li')
      .filter({ has: page.locator('strong', { hasText: new RegExp(`^v${version}( ·|$)`) }) })
  const badges = (version: number) => row(version).locator('.release-status').allTextContents()
  const confirm = async (action: string, button: string) => {
    await dialog.getByRole('button', { name: action, exact: true }).click()
    await dialog.getByRole('button', { name: button, exact: true }).click()
  }
  const visit = async (url: string) => {
    const tab = await context.newPage()
    const response = await tab.goto(url)
    const h1 = response?.ok() ? await tab.locator('h1').first().textContent() : null
    await tab.close()
    return { status: response?.status(), robots: response?.headers()['x-robots-tag'], h1 }
  }

  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await dialog.getByLabel('Release name', { exact: true }).fill('Draft check')
  await dialog.getByRole('button', { name: 'Publish v1 to testing', exact: true }).click()
  await expect
    .poll(() => summary.textContent(), { timeout: 60_000 })
    .toContain('Testing: v1 · Draft check')
  expect(await summary.textContent()).toContain('This site has not been published yet.')
  expect(await badges(1)).toEqual(['Testing'])
  const testingUrl = await dialog
    .getByRole('link', { name: 'Open testing site' })
    .getAttribute('href')
  expect(testingUrl).toMatch(/^http:\/\/[0-9a-f-]{36}-testing\.localhost:\d+$/)
  const productionUrl = testingUrl!.replace('-testing.', '.')
  expect(await visit(testingUrl!)).toEqual({
    status: 200,
    robots: 'noindex, nofollow',
    h1: 'Your website. Your rules.',
  })
  expect((await visit(productionUrl)).status).toBe(404)

  // Promotion re-points production at the same build; no new release appears.
  await confirm('Promote v1 to production', 'Confirm promotion')
  await expect.poll(() => summary.textContent()).toContain('Live: v1 · Draft check')
  expect(await badges(1)).toEqual(['Live', 'Testing'])
  expect(await dialog.locator('.release-list > li').count()).toBe(1)
  expect(await visit(productionUrl)).toMatchObject({ status: 200, robots: undefined })

  await dialog.getByRole('button', { name: 'Close publishing' }).click()
  await heading.click()
  await page.getByLabel('Text', { exact: true }).fill('Second release')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await dialog.getByRole('button', { name: 'Publish v2', exact: true }).click()
  await expect.poll(() => summary.textContent(), { timeout: 60_000 }).toContain('Live: v2')
  expect(await summary.textContent()).toContain('Testing: v1 · Draft check')
  expect((await visit(productionUrl)).h1).toBe('Second release')
  expect((await visit(testingUrl!)).h1).toBe('Your website. Your rules.')

  // v1 is on testing, so production goes back to it by promotion, not by a restore; the
  // pointer rules themselves are covered through the API in publishing.test.ts.
  expect(await row(1).getByRole('button', { name: 'Restore v1' }).count()).toBe(0)
}, 240_000)
