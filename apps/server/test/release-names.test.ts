import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('names releases, keeps only the latest in view and restores an earlier one', async () => {
  const { page } = await editor()

  const dialog = page.locator('.publish-dialog')
  const summary = dialog.locator('.publish-summary')
  const top = dialog.locator('.release-list').first().locator('> li')
  const publish = async (version: number, name: string) => {
    await dialog.getByLabel('Release name', { exact: true }).fill(name)
    await dialog.getByRole('button', { name: `Publish v${version}`, exact: true }).click()
    await expect
      .poll(() => summary.textContent(), { timeout: 60_000 })
      .toContain(`Live: v${version} · ${name}`)
  }
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await publish(1, 'First light')
  await expect.poll(() => dialog.getByLabel('Release name', { exact: true }).inputValue()).toBe('')
  await publish(2, 'Spring launch')

  // Only the live, newest release stays in view; the first folds into a closed section.
  await expect.poll(() => top.count()).toBe(1)
  await expect.poll(() => top.first().locator('strong').textContent()).toBe('v2 · Spring launch')
  const earlier = dialog.locator('.earlier-releases')
  expect(await earlier.getAttribute('open')).toBeNull()
  expect(await dialog.getByRole('button', { name: 'Restore v1', exact: true }).isVisible()).toBe(
    false,
  )
  await earlier.getByText('Earlier releases (1)').click()
  await expect.poll(() => earlier.locator('li strong').textContent()).toBe('v1 · First light')

  // Renaming inline keeps the version and saves through the API.
  await earlier.getByRole('button', { name: 'Rename v1', exact: true }).click()
  await earlier.getByLabel('Name for v1', { exact: true }).fill('First light, revisited')
  await earlier.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect
    .poll(() => earlier.locator('li strong').textContent())
    .toBe('v1 · First light, revisited')

  await earlier.getByRole('button', { name: 'Restore v1', exact: true }).click()
  await earlier.getByRole('button', { name: 'Confirm rollback', exact: true }).click()
  await expect.poll(() => summary.textContent()).toContain('Live: v1 · First light, revisited')
  // The newest release and the live one are both in view now; nothing is left to fold.
  await expect.poll(() => top.count()).toBe(2)
  expect(await earlier.count()).toBe(0)
}, 240_000)
