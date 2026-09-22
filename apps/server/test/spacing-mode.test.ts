import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer as tcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createServer } from '../src/app.js'

it('switches spacing mode with the chip: nubs, labelled boxes, sidebar focus, text editing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-spacing-mode-'))
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
    secret: 'spacing-mode-test-8d2f64c1a9b347e0b5d1c2e3f4a5',
    allowSignup: true,
  })
  const listener = serve({ fetch: server.app.fetch, port: address.port, hostname: '127.0.0.1' })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Spacing mode test')
    await page.getByLabel('Email', { exact: true }).fill('spacing-mode@example.test')
    await page.getByLabel('Password', { exact: true }).fill('spacing-mode-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Spacing mode')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const cta = canvas.locator('[data-freeflow-node="n-home-cta"]')
    await cta.waitFor()
    await cta.click()

    const saved = () =>
      expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')
    const chip = canvas.getByRole('button', { name: 'Spacing', exact: true })
    // Rendered at all (a zero-size strip still counts), through the shadow host and handles layer.
    const shown = (selector: string) =>
      canvas.locator(selector).evaluate((element) => element.checkVisibility())
    const strip = (selector: string) =>
      canvas.locator(selector).evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        label: element.textContent,
      }))
    const paddingTop = (element: typeof cta) =>
      element.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingTop))
    const preview = path.join(root, '.freeflow/editor-preview')
    await mkdir(preview, { recursive: true })

    // A fresh selection shows its outline, bars and size handles, but no spacing nubs or boxes.
    await expect.poll(() => shown('.handle.size.right')).toBe(true)
    expect(await chip.getAttribute('aria-pressed')).toBe('false')
    expect(await shown('.handle.padding.top')).toBe(false)
    expect(await shown('.handle.margin.top')).toBe(false)
    expect(await shown('.strip.padding.top')).toBe(false)

    // The chip turns on the nubs and the boxes; the top padding strip is as tall as the padding.
    await chip.click()
    await expect.poll(() => chip.getAttribute('aria-pressed')).toBe('true')
    await expect.poll(() => shown('.handle.padding.top')).toBe(true)
    expect(await shown('.handle.margin.left')).toBe(true)
    expect(await shown('.strip.margin.bottom')).toBe(true)
    const top = await paddingTop(cta)
    expect(top).toBeGreaterThan(0)
    await expect
      .poll(async () => Math.abs((await strip('.strip.padding.top')).height - top))
      .toBeLessThan(1)
    expect((await strip('.strip.padding.top')).label).toBe(String(Math.round(top)))
    await page.screenshot({ path: path.join(preview, 'spacing-mode-cta.png') })

    // The mode survives a colour commit (a morph) and a selection change.
    await canvas.getByRole('button', { name: /^Background color: / }).click()
    await expect.poll(() => canvas.locator('.wheel').count()).toBe(1)
    await canvas.locator('.swatches button').nth(2).click()
    await canvas.getByRole('button', { name: /^Background color: / }).click()
    await saved()
    expect(await chip.getAttribute('aria-pressed')).toBe('true')
    expect(await shown('.strip.padding.top')).toBe(true)
    const title = canvas.locator('[data-freeflow-node="n-home-title"]')
    await title.click()
    await expect.poll(() => title.getAttribute('data-freeflow-selected')).toBe('')
    expect(await chip.getAttribute('aria-pressed')).toBe('true')
    expect(await shown('.strip.margin.bottom')).toBe(true)
    expect(await shown('.handle.padding.top')).toBe(true)
    const titleTop = await paddingTop(title)
    await expect
      .poll(async () => Math.abs((await strip('.strip.padding.top')).height - titleTop))
      .toBeLessThan(1)
    await page.screenshot({ path: path.join(preview, 'spacing-mode-title.png') })

    // Dragging the top nub (Ctrl: no token snapping) moves the bottom label live while the readout
    // stands in for the top one; after the commit the top label reads the new padding.
    await cta.click()
    await expect.poll(() => cta.getAttribute('data-freeflow-selected')).toBe('')
    const bottom0 = (await strip('.strip.padding.bottom')).label
    const nub = canvas.locator('.handle.padding.top')
    const box = (await nub.boundingBox())!
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    const cdp = await context.newCDPSession(page)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...from,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    for (let step = 1; step <= 10; step++)
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x,
        y: from.y - (20 * step) / 10,
        button: 'left',
        buttons: 1,
        modifiers: 2,
      })
    await expect.poll(async () => (await strip('.strip.padding.bottom')).label).not.toBe(bottom0)
    expect((await strip('.strip.padding.top')).label).toBe('')
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: from.x,
      y: from.y - 20,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    await saved()
    const dragged = await paddingTop(cta)
    expect(dragged).toBeGreaterThan(top + 10)
    await expect
      .poll(async () => (await strip('.strip.padding.top')).label)
      .toBe(String(Math.round(dragged)))

    // Chip off: focusing a sidebar spacing input shows the boxes (not the nubs) until it blurs.
    await chip.click()
    await expect.poll(() => shown('.strip.padding.top')).toBe(false)
    expect(await shown('.handle.padding.top')).toBe(false)
    await page.getByRole('button', { name: 'Layout', exact: true }).click()
    const input = page.locator('.ribbon-controls').getByLabel('Inside spacing top', { exact: true })
    await input.focus()
    await expect.poll(() => shown('.strip.padding.top')).toBe(true)
    expect(await shown('.handle.padding.top')).toBe(false)
    await input.blur()
    await expect.poll(() => shown('.strip.padding.top')).toBe(false)

    // Inline text editing hides the chip and every handle; leaving it brings them back.
    await chip.click()
    await expect.poll(() => shown('.handle.padding.top')).toBe(true)
    await cta.dblclick()
    await canvas.getByLabel('Canvas text editor').waitFor()
    await expect.poll(() => shown('.spacing')).toBe(false)
    expect(await shown('.handle.padding.top')).toBe(false)
    expect(await shown('.handle.size.right')).toBe(false)
    await page.getByRole('button', { name: 'Cancel text edit', exact: true }).click()
    await expect.poll(() => shown('.spacing')).toBe(true)
    expect(await shown('.handle.padding.top')).toBe(true)

    expect(errors).toEqual([])
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 60000)
