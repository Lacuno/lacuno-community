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

it('drags an element at its size on the zoomed canvas', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-drag-size-'))
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
    secret: 'drag-size-test-3c9e1f7a52b04d68e1a7',
    allowSignup: true,
  })
  const listener = serve({ fetch: server.app.fetch, port: address.port, hostname: '127.0.0.1' })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Drag size')
    await page.getByLabel('Email', { exact: true }).fill('size@example.test')
    await page.getByLabel('Password', { exact: true }).fill('drag-size-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Drag size')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
    const ghost = page
      .frameLocator('iframe[title="Drag preview"]')
      .locator('[data-freeflow-drag-ghost]')
    const heading = canvas.locator('[data-freeflow-node="n-home-title"]')
    const lead = canvas.locator('[data-freeflow-node="n-home-lead"]')
    const cdp = await context.newCDPSession(page)
    const mouse = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', x: number, y: number) =>
      cdp.send('Input.dispatchMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: type === 'mouseMoved' ? 0 : 1,
      })
    // The dragged element keeps its canvas size and grab point at every canvas zoom.
    for (const preset of ['Desktop', 'Tablet']) {
      await page.getByRole('button', { name: preset, exact: true }).click()
      await heading.click()
      const box = (await heading.boundingBox())!
      const from = { x: box.x + 40, y: box.y + box.height / 2 }
      const to = { x: from.x, y: (await lead.boundingBox())!.y + 10 }
      await mouse('mousePressed', from.x, from.y)
      for (let step = 1; step <= 10; step++)
        await mouse('mouseMoved', to.x, from.y + ((to.y - from.y) * step) / 10)
      await expect.poll(() => ghost.count()).toBe(1)
      await mouse('mouseMoved', to.x, to.y)
      await expect
        .poll(async () => (await ghost.boundingBox())!.y - (to.y - (from.y - box.y)))
        .toBeCloseTo(0, 0)
      const dragged = (await ghost.boundingBox())!
      expect(dragged.width).toBeCloseTo(box.width, 0)
      expect(dragged.height).toBeCloseTo(box.height, 0)
      expect(dragged.x).toBeCloseTo(box.x, 0)
      await cdp.send('Input.cancelDragging')
      await page.keyboard.press('Escape')
      await mouse('mouseReleased', to.x, to.y)
      await expect.poll(() => ghost.count()).toBe(0)
    }
  } finally {
    await browser.close()
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    )
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 40000)
