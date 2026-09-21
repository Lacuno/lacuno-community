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

it('edits a hover state in the canvas, publishes its rule and undoes it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-states-'))
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
    publishBaseURL: 'http://localhost:3101',
    secret: 'states-test-9f2c41d0a7b84e3c95ad6f',
    allowSignup: true,
  })
  const listener = serve({ fetch: server.app.fetch, port: address.port, hostname: '127.0.0.1' })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const saved = () =>
      expect
        .poll(() => page.locator('.save-state').textContent(), { timeout: 8000 })
        .toBe('All changes saved')
    const background = (id: string) =>
      canvas
        .locator(`[data-freeflow-node="${id}"]`)
        .evaluate((element) => getComputedStyle(element).backgroundColor)
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('States test')
    await page.getByLabel('Email', { exact: true }).fill('states@example.test')
    await page.getByLabel('Password', { exact: true }).fill('states-test-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Hover states')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
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

    const cookie = (await context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ')
    const api = (route: string, body?: unknown) =>
      server.app.request(origin + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    const { sites } = (await (await api('/api/sites')).json()) as {
      sites: { id: string; revision: number }[]
    }
    const site = sites[0]!
    const release = (await (
      await api(`/api/sites/${site.id}/releases`, {
        expectedRevision: site.revision,
        publishedId: null,
      })
    ).json()) as { id: string }
    type History = { url: string; releases: { id: string; status: string }[] }
    const history = async () =>
      (await (await api(`/api/sites/${site.id}/releases`)).json()) as History
    await expect
      .poll(async () => (await history()).releases.find((row) => row.id === release.id)?.status, {
        timeout: 60_000,
      })
      .toBe('ready')
    const live = (await history()).url
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
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 120_000)
