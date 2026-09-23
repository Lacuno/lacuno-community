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

const freePort = async () => {
  const reservation = tcpServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('No port available')
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  return address.port
}

it('publishes to staging, promotes the same build and keeps staging through a rollback', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-staging-'))
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const port = await freePort()
  const publishPort = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const server = await createServer({
    dataDir: dir,
    templateDir: path.join(root, 'templates/freeflow'),
    editorDir: path.join(root, 'apps/editor/dist'),
    baseURL: origin,
    publishBaseURL: `http://localhost:${publishPort}`,
    secret: 'staging-test-secret-5b1e0c7d93a4f2',
    allowSignup: true,
  })
  const listener = serve({ fetch: server.app.fetch, port, hostname: '127.0.0.1' })
  const published = serve({
    fetch: server.published!.fetch,
    port: publishPort,
    hostname: '127.0.0.1',
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
    page.setDefaultTimeout(8000)
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Staging')
    await page.getByLabel('Email', { exact: true }).fill('staging@example.test')
    await page.getByLabel('Password', { exact: true }).fill('staging-test-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Staged site')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const heading = page
      .frameLocator('iframe[title="Site canvas"]')
      .locator('[data-freeflow-node="n-home-title"]')
    await heading.waitFor()

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
      const tab = await browser.newPage()
      const response = await tab.goto(url)
      const h1 = response?.ok() ? await tab.locator('h1').first().textContent() : null
      await tab.close()
      return { status: response?.status(), robots: response?.headers()['x-robots-tag'], h1 }
    }

    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await dialog.getByLabel('Release name', { exact: true }).fill('Draft check')
    await dialog.getByRole('button', { name: 'Publish v1 to staging', exact: true }).click()
    await expect
      .poll(() => summary.textContent(), { timeout: 60_000 })
      .toContain('Staging: v1 · Draft check')
    expect(await summary.textContent()).toContain('This site has not been published yet.')
    expect(await badges(1)).toEqual(['Staging'])
    const stagingUrl = await dialog
      .getByRole('link', { name: 'Open staging site' })
      .getAttribute('href')
    expect(stagingUrl).toMatch(/^http:\/\/[0-9a-f-]{36}-staging\.localhost:\d+$/)
    const productionUrl = stagingUrl!.replace('-staging.', '.')
    expect(await visit(stagingUrl!)).toEqual({
      status: 200,
      robots: 'noindex, nofollow',
      h1: 'Your website. Your rules.',
    })
    expect((await visit(productionUrl)).status).toBe(404)

    // Promotion re-points production at the same build; no new release appears.
    await confirm('Promote v1 to production', 'Confirm promotion')
    await expect.poll(() => summary.textContent()).toContain('Live: v1 · Draft check')
    expect(await badges(1)).toEqual(['Live', 'Staging'])
    expect(await dialog.locator('.release-list > li').count()).toBe(1)
    expect(await visit(productionUrl)).toMatchObject({ status: 200, robots: undefined })

    await dialog.getByRole('button', { name: 'Close publishing' }).click()
    await heading.click()
    await page.getByLabel('Text', { exact: true }).fill('Second release')
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await dialog.getByRole('button', { name: 'Publish v2', exact: true }).click()
    await expect.poll(() => summary.textContent(), { timeout: 60_000 }).toContain('Live: v2')
    expect(await summary.textContent()).toContain('Staging: v1 · Draft check')
    expect((await visit(productionUrl)).h1).toBe('Second release')
    expect((await visit(stagingUrl!)).h1).toBe('Your website. Your rules.')

    // v1 is staged, so rolling production back to it is a promotion.
    expect(await row(1).getByRole('button', { name: 'Restore v1' }).count()).toBe(0)
    await confirm('Promote v1 to production', 'Confirm promotion')
    await expect.poll(() => summary.textContent()).toContain('Live: v1 · Draft check')
    expect(await badges(1)).toEqual(['Live', 'Staging'])
    expect((await visit(productionUrl)).h1).toBe('Your website. Your rules.')

    await confirm('Stage v2', 'Confirm staging')
    await expect.poll(() => summary.textContent()).toContain('Staging: v2')
    expect(await badges(2)).toEqual(['Staging'])
    expect((await visit(stagingUrl!)).h1).toBe('Second release')
    expect((await visit(productionUrl)).h1).toBe('Your website. Your rules.')
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    await new Promise<void>((resolve) => published.close(() => resolve()))
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 240_000)
