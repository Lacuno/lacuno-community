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

it('says a publish waits for a build slot while Cloud runs as many builds as it can', async () => {
  const { page } = await editor()
  const dialog = page.locator('.publish-dialog')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await dialog.getByRole('button', { name: 'Publish v1', exact: true }).waitFor()

  // The server reports the release `waiting` until its slot comes (releases.ts).
  const releases = /\/api\/sites\/[^/]+\/releases$/
  await page.route(releases, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const history = await response.json()
    for (const row of history.releases)
      if (row.status === 'queued' || row.status === 'building') row.status = 'waiting'
    await route.fulfill({ response, json: history })
  })
  await dialog.getByRole('button', { name: 'Publish v1', exact: true }).click()
  await dialog.getByText('Waiting for a build slot…').waitFor({ timeout: 30_000 })
  expect(await dialog.locator('.release-list').textContent()).toContain('Waiting for a build slot')

  await page.unroute(releases)
  await expect
    .poll(() => dialog.locator('.publish-summary').textContent(), { timeout: 60_000 })
    .toContain('Live: v1')
}, 120_000)
