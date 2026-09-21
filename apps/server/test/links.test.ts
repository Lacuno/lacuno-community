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

it('inserts a button, points it at a page and follows the page through a path change', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-links-'))
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
    publishBaseURL: 'http://localhost:3102',
    secret: 'links-test-4b81ce07da2f96b35e8c17',
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
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Links test')
    await page.getByLabel('Email', { exact: true }).fill('links@example.test')
    await page.getByLabel('Password', { exact: true }).fill('links-test-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Links and buttons')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
    await canvas.locator('[data-freeflow-node="n-home-cta"]').waitFor()

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

    const cookie = (await context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ')
    const api = (route: string, body?: unknown) =>
      server.app.request(origin + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    const site = async () =>
      ((await (await api('/api/sites')).json()) as { sites: { id: string; revision: number }[] })
        .sites[0]!
    type History = { publishedId: string | null; url: string; releases: { id: string }[] }
    const history = async (id: string) =>
      (await (await api(`/api/sites/${id}/releases`)).json()) as History
    const publish = async () => {
      const { id, revision } = await site()
      const before = await history(id)
      const release = (await (
        await api(`/api/sites/${id}/releases`, {
          expectedRevision: revision,
          publishedId: before.publishedId,
        })
      ).json()) as { id: string }
      await expect
        .poll(async () => (await history(id)).publishedId, { timeout: 60_000 })
        .toBe(release.id)
      const live = (await history(id)).url
      return await (await server.published!.request(`${live}/`)).text()
    }
    // The template's own static links pin a path; only the inserted button holds a page binding.
    expect(await publish()).toMatch(/<a [^>]*href="\/about"[^>]*>Button<\/a>/)

    // Renaming the path moves the link with it; the binding never held the old path.
    await page.getByRole('button', { name: 'Pages', exact: true }).click()
    await page.getByRole('button', { name: 'Settings for About', exact: true }).click()
    await page.getByLabel('URL path', { exact: true }).fill('/company')
    await page.getByRole('button', { name: 'Save page', exact: true }).click()
    await saved()
    await expect.poll(() => button.getAttribute('href')).toBe('/company')
    const republished = await publish()
    expect(republished).toMatch(/<a [^>]*href="\/company"[^>]*>Button<\/a>/)
    expect(republished).not.toMatch(/<a [^>]*href="\/about"[^>]*>Button<\/a>/)
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 240_000)
