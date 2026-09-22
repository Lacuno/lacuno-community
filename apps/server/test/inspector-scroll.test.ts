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

it('keeps the inspector scroll position across a spacing edit', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-inspector-scroll-'))
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
    secret: 'inspector-scroll-test-5c1e8a0b9d3f4e27a6b1',
    allowSignup: true,
  })
  const listener = serve({ fetch: server.app.fetch, port: address.port, hostname: '127.0.0.1' })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 700 } })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Scroll test')
    await page.getByLabel('Email', { exact: true }).fill('inspector-scroll@example.test')
    await page.getByLabel('Password', { exact: true }).fill('inspector-scroll-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Scroll')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const cta = canvas.locator('[data-freeflow-node="n-home-cta"]')
    await cta.waitFor()
    await cta.click()

    // Scroll the inspector down to the spacing inputs.
    const inspector = page.locator('aside.inspector')
    const scrollTop = () => inspector.evaluate((element) => element.scrollTop)
    const saved = () =>
      expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')
    const input = inspector.getByLabel('Inside spacing top', { exact: true })
    await input.scrollIntoViewIfNeeded()
    const scrolled = await scrollTop()
    expect(scrolled).toBeGreaterThan(0)

    await input.fill('30')
    await saved()
    expect(await scrollTop()).toBe(scrolled)

    // A padding handle drag commits the same edit from the canvas.
    // Spacing nubs show in spacing mode, switched on by the chip in the selection's top bar.
    const spacingChip = canvas.getByRole('button', { name: 'Spacing', exact: true })
    await spacingChip.click()
    await expect.poll(() => spacingChip.getAttribute('aria-pressed')).toBe('true')
    const nub = canvas.locator('.handle.padding.top')
    await nub.waitFor()
    const box = (await nub.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => input.inputValue()).not.toBe('30')
    await saved()
    expect(await scrollTop()).toBe(scrolled)

    expect(errors).toEqual([])
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 60000)
