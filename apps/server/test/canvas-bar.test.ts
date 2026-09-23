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

it('shows the state chip and colour wheel on the canvas selection bar', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-canvas-bar-'))
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
    secret: 'canvas-bar-test-3c9e51ab7d264f8091ce',
    allowSignup: true,
  })
  const listener = serve({ fetch: server.app.fetch, port: address.port, hostname: '127.0.0.1' })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Canvas bar test')
    await page.getByLabel('Email', { exact: true }).fill('bar@example.test')
    await page.getByLabel('Password', { exact: true }).fill('canvas-bar-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Canvas bar')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const cta = canvas.locator('[data-freeflow-node="n-home-cta"]')
    await cta.waitFor()
    await cta.click()
    // The bars carry the state chip and, for a text node, both a text and a background swatch.
    await expect.poll(() => canvas.getByRole('button', { name: /^State: / }).count()).toBe(1)
    await expect.poll(() => canvas.getByRole('button', { name: /^Text color: / }).count()).toBe(1)
    await expect
      .poll(() => canvas.getByRole('button', { name: /^Background color: / }).count())
      .toBe(1)
    // Opening the swatch reveals the wheel, the project colours and the save field.
    await canvas.getByRole('button', { name: /^Text color: / }).click()
    await expect.poll(() => canvas.locator('.wheel').count()).toBe(1)
    await expect.poll(() => canvas.getByLabel('Project color name').count()).toBe(1)
    // Every colour gesture commits as it ends, with the wheel still open.
    const applied = (property: string) =>
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/document/apply') &&
          !!response.request().postData()?.includes(property),
      )
    // The template ships project colours; picking one binds the element.
    const dots = canvas.locator('.swatches button')
    await expect.poll(() => dots.count()).toBeGreaterThan(0)
    const before = await cta.evaluate((element) => getComputedStyle(element).color)
    const color = applied('"color"')
    await dots.first().click()
    await color
    await expect
      .poll(() => cta.evaluate((element) => getComputedStyle(element).color))
      .not.toBe(before)

    // A wheel drag commits on release, so switching state straight after keeps the colour.
    await canvas.getByRole('button', { name: /^Background color: / }).click()
    const wheel = (await canvas.locator('.wheel').boundingBox())!
    const background = applied('background-color')
    // Raw input events: Playwright's mouse.move never resolves under the wheel's pointer capture.
    const cdp = await context.newCDPSession(page)
    const mouse = (
      type: 'mousePressed' | 'mouseMoved' | 'mouseReleased',
      x: number,
      y: number,
      buttons = 1,
    ) =>
      cdp.send('Input.dispatchMouseEvent', {
        type,
        x: wheel.x + wheel.width * x,
        y: wheel.y + wheel.height * y,
        button: 'left',
        buttons,
        clickCount: 1,
      })
    await mouse('mousePressed', 0.2, 0.5)
    for (const step of [0.25, 0.3, 0.35]) await mouse('mouseMoved', step, step)
    await mouse('mouseReleased', 0.35, 0.35, 0)
    await background
    // The open wheel covers the chip here, so the click goes to the chip itself.
    await canvas.getByRole('button', { name: /^State: / }).dispatchEvent('click')
    await canvas.getByRole('menuitemradio', { name: /^Hover/ }).click()
    await expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 60000)
