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

it('clears the selection on a click in the empty canvas space, not on panel controls', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-deselect-'))
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
    secret: 'deselect-test-8f2a61c9e04b47d3a5b1',
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
    await page.getByLabel('Your name').fill('Deselect test')
    await page.getByLabel('Email', { exact: true }).fill('deselect@example.test')
    await page.getByLabel('Password', { exact: true }).fill('deselect-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Deselect')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const cta = canvas.locator('[data-freeflow-node="n-home-cta"]')
    await cta.waitFor()
    const selectedCount = () => canvas.locator('[data-freeflow-selected]').count()
    const emptyInspector = () => page.locator('.inspector-empty').count()
    // The workspace's left padding is empty canvas space next to the iframe.
    const clickBackground = async () => {
      const box = (await page.locator('.canvas-workspace').boundingBox())!
      await page.mouse.click(box.x + 10, box.y + box.height / 2)
    }

    await cta.click()
    await expect.poll(selectedCount).toBe(1)
    await expect.poll(emptyInspector).toBe(0)
    await clickBackground()
    await expect.poll(selectedCount).toBe(0)
    await expect.poll(emptyInspector).toBeGreaterThan(0)

    // Panel controls keep the selection.
    await cta.click()
    await expect.poll(selectedCount).toBe(1)
    await page.getByRole('button', { name: 'Tablet', exact: true }).click()
    await expect.poll(() => page.locator('.canvas-toolbar .muted').textContent()).toBe('768px')
    await expect.poll(selectedCount).toBe(1)
    await expect.poll(emptyInspector).toBe(0)

    // A click away from the inline text editor commits the typed text, then deselects.
    await cta.dblclick()
    const editable = canvas.getByLabel('Canvas text editor')
    await editable.waitFor()
    await editable.press('End')
    await editable.pressSequentially(' now')
    await clickBackground()
    await expect.poll(selectedCount).toBe(0)
    await expect.poll(() => editable.count()).toBe(0)
    await expect.poll(() => cta.textContent()).toMatch(/ now$/)
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 60000)
