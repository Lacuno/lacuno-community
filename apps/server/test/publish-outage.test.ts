import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('keeps following a publish while the server cannot be reached, with a clear note', async () => {
  const { page } = await editor()
  const dialog = page.locator('.publish-dialog')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await dialog.getByRole('button', { name: 'Publish v1', exact: true }).waitFor()

  // A proxy answers for the server while Cloud redeploys; the publish itself got through.
  const releases = /\/api\/sites\/[^/]+\/releases$/
  await page.route(releases, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>Bad Gateway</h1>' })
      : route.continue(),
  )
  await dialog.getByRole('button', { name: 'Publish v1', exact: true }).click()
  const note = dialog.getByText(
    'Lacuno cannot be reached right now. A publish in progress carries on',
  )
  await note.waitFor()
  expect(await dialog.textContent()).not.toContain('Bad Gateway')

  await page.unroute(releases)
  await expect
    .poll(() => dialog.locator('.publish-summary').textContent(), { timeout: 60_000 })
    .toContain('Live: v1')
  await expect.poll(() => note.count()).toBe(0)
}, 120_000)
