import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import type { Document } from '@miralo/schema'
import { type Browser, chromium, type Page } from 'playwright'
import { expect, onTestFinished } from 'vitest'
import { createServer } from '../src/app.js'

export const root = fileURLToPath(new URL('../../../', import.meta.url))

/** The account editor() signs up with. */
export const account = { email: 'tester@example.test', password: 'tester-password' }

export type History = {
  publishedId: string | null
  testingId: string | null
  url: string
  releases: { id: string; status: string }[]
}

/**
 * A server with publishing and a browser page on it. Both listen on ports the OS picks before the
 * server exists, so parallel files never race for a port. Everything closes when the test ends.
 */
export async function launch(viewport = { width: 1500, height: 1000 }, allowSignup = true) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'miralo-test-'))
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  let browser: Browser | undefined
  const hostname = '127.0.0.1'
  const app = serve({ fetch: (request, env) => server!.app.fetch(request, env), port: 0, hostname })
  const published = serve({
    fetch: (request) => server!.published!.fetch(request),
    port: 0,
    hostname,
  })
  onTestFinished(async () => {
    await browser?.close()
    for (const listener of [app, published])
      await new Promise<void>((resolve) => listener.close(() => resolve()))
    server?.close()
    await rm(dir, { recursive: true, force: true })
  })
  for (const listener of [app, published])
    if (!listener.listening) await once(listener, 'listening')
  const port = (listener: typeof app) => (listener.address() as AddressInfo).port
  const origin = `http://${hostname}:${port(app)}`
  server = await createServer({
    dataDir: dir,
    templateDir: path.join(root, 'templates/miralo'),
    editorDir: path.join(root, 'apps/editor/dist'),
    baseURL: origin,
    publishBaseURL: `http://localhost:${port(published)}`,
    secret: 'browser-test-secret-5b1e0c7d93a4f2e8',
    allowSignup,
  })
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport })
  context.setDefaultTimeout(8000)
  const page = await context.newPage()
  return { dir, server, context, page, origin }
}

/** launch(), signed up and on a new site's canvas, with the API helpers the tests share. */
export async function editor(viewport?: { width: number; height: number }) {
  const launched = await launch(viewport)
  const { server, context, page, origin } = launched
  await page.goto(origin)
  await page.getByRole('button', { name: 'New here? Create an account' }).click()
  await page.getByLabel('Your name').fill('Tester')
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByLabel('Site name').fill('Test site')
  await page.getByRole('button', { name: 'Create site', exact: false }).click()
  const canvas = page.frameLocator('iframe[title="Site canvas"]')
  await canvas.locator('[data-miralo-node]').first().waitFor()
  const siteId = new URL(page.url()).searchParams.get('site')!

  const api = async (route: string, body?: unknown) => {
    const cookie = (await context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ')
    return server.app.request(origin + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }
  const document = async () =>
    ((await (await api(`/api/sites/${siteId}/document`)).json()) as { document: Document }).document
  const history = async () => (await (await api(`/api/sites/${siteId}/releases`)).json()) as History
  /** Publishes the saved draft to production and returns the live URL once it serves it. */
  const publish = async () => {
    const release = (await (
      await api(`/api/sites/${siteId}/releases`, {
        expectedRevision: (await document()).revision,
        expectedId: (await history()).publishedId,
      })
    ).json()) as { id: string }
    await expect
      .poll(async () => (await history()).publishedId, { timeout: 60_000 })
      .toBe(release.id)
    return (await history()).url
  }

  // The status line already reads "All changes saved" before a debounced save starts, so saved()
  // waits for a document write since its last call to land, then for the status to settle.
  let writes = 0
  let seen = 0
  page.on('response', (response) => {
    if (response.url().endsWith('/document/apply')) writes++
  })
  const saved = async () => {
    await expect.poll(() => writes).toBeGreaterThan(seen)
    await expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')
    seen = writes
  }

  return { ...launched, canvas, siteId, api, document, history, publish, saved }
}

/**
 * Presses a canvas handle and moves it by (dx, dy) screen px in 15 steps with raw CDP input, since
 * Playwright's mouse stalls under pointer capture. `modifiers` is CDP's mask (1 Alt, 2 Ctrl,
 * 8 Shift). The result releases the pointer; with `back` it first returns to where it started.
 */
export async function press(
  page: Page,
  handle: string,
  move: { dx?: number; dy?: number },
  modifiers = 0,
) {
  const nub = page.frameLocator('iframe[title="Site canvas"]').locator(handle)
  await nub.waitFor()
  const box = (await nub.boundingBox())!
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const dx = move.dx ?? 0
  const dy = move.dy ?? 0
  const cdp = await page.context().newCDPSession(page)
  const send = (
    type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
    point: { x: number; y: number },
  ) =>
    cdp.send('Input.dispatchMouseEvent', {
      type,
      ...point,
      button: 'left',
      buttons: type === 'mouseReleased' ? 0 : 1,
      clickCount: type === 'mouseMoved' ? 0 : 1,
      modifiers,
    })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
  await send('mousePressed', from)
  for (let step = 1; step <= 15; step++)
    await send('mouseMoved', { x: from.x + (dx * step) / 15, y: from.y + (dy * step) / 15 })
  return async (back = false) => {
    if (back) await send('mouseMoved', from)
    await send('mouseReleased', back ? from : { x: from.x + dx, y: from.y + dy })
  }
}

/** A whole press(): press, move and release. */
export const drag = async (
  page: Page,
  handle: string,
  move: { dx?: number; dy?: number },
  modifiers = 0,
  back = false,
) => (await press(page, handle, move, modifiers))(back)
