import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer as tcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createServer } from '../src/app.js'

it('names releases, keeps only the latest in view and restores an earlier one', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-release-names-'))
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const reservation = tcpServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('No port available')
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const origin = `http://127.0.0.1:${address.port}`
  const server = await createServer({
    dataDir: dir,
    templateDir: path.join(root, 'templates/freeflow'),
    editorDir: path.join(root, 'apps/editor/dist'),
    baseURL: origin,
    publishBaseURL: 'http://localhost:3103',
    secret: 'release-names-test-8d2f61ab04c9e7',
    allowSignup: true,
  })
  const listener = serve({ fetch: server.app.fetch, port: address.port, hostname: '127.0.0.1' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
    page.setDefaultTimeout(8000)
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Release names')
    await page.getByLabel('Email', { exact: true }).fill('release-names@example.test')
    await page.getByLabel('Password', { exact: true }).fill('release-names-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Named releases')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    await page
      .frameLocator('iframe[title="Site canvas"]')
      .locator('[data-freeflow-node]')
      .first()
      .waitFor()

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
    await expect
      .poll(() => dialog.getByLabel('Release name', { exact: true }).inputValue())
      .toBe('')
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
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 240_000)
