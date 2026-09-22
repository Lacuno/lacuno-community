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

it('drags on-canvas padding and margin handles: symmetric, Alt single-side, one undo step', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-spacing-'))
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
    secret: 'spacing-test-3c9e51ab7d264f8091ce7f1a2b3c',
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
    let writes = 0
    page.on('request', (request) => {
      if (request.url().endsWith('/document/apply')) writes++
    })
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Spacing test')
    await page.getByLabel('Email', { exact: true }).fill('spacing@example.test')
    await page.getByLabel('Password', { exact: true }).fill('spacing-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Spacing')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const cta = canvas.locator('[data-freeflow-node="n-home-cta"]')
    await cta.waitFor()
    await cta.click()

    const value = (property: string) =>
      cta.evaluate(
        (element, p) => Number.parseFloat(getComputedStyle(element).getPropertyValue(p)),
        property,
      )
    // Read two sides in one snapshot so a symmetric comparison can't catch them mid-commit.
    const pair = (a: string, b: string) =>
      cta.evaluate(
        (element, props) => {
          const style = getComputedStyle(element)
          return props.map((p) => Number.parseFloat(style.getPropertyValue(p)))
        },
        [a, b],
      )
    // Iframe transform scale: the pointer maps to CSS px through it, so a screen drag of d moves
    // the edge d/zoom CSS px (the handle math uses the iframe's own coordinates, no division).
    const zoom = await page
      .locator('iframe[title="Site canvas"]')
      .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
    expect(zoom).toBeLessThan(1)

    // Spacing nubs show in spacing mode, switched on by the chip in the selection's top bar.
    const spacingChip = canvas.getByRole('button', { name: 'Spacing', exact: true })
    await spacingChip.click()
    await expect.poll(() => spacingChip.getAttribute('aria-pressed')).toBe('true')
    const cdp = await context.newCDPSession(page)
    const drag = async (
      handle: string,
      move: { dx?: number; dy?: number },
      alt = false,
    ): Promise<void> => {
      const nub = canvas.locator(handle)
      await nub.waitFor()
      const box = (await nub.boundingBox())!
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      const dx = move.dx ?? 0
      const dy = move.dy ?? 0
      const modifiers = alt ? 1 : 0
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...from,
        button: 'left',
        buttons: 1,
        clickCount: 1,
        modifiers,
      })
      for (let step = 1; step <= 15; step++)
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: from.x + (dx * step) / 15,
          y: from.y + (dy * step) / 15,
          button: 'left',
          buttons: 1,
          modifiers,
        })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: from.x + dx,
        y: from.y + dy,
        button: 'left',
        buttons: 0,
        clickCount: 1,
        modifiers,
      })
    }

    // Symmetric padding: dragging the top handle up grows padding-top AND padding-bottom equally.
    const [padTop0, padBottom0] = await pair('padding-top', 'padding-bottom')
    const before = writes
    await drag('.handle.padding.top', { dy: -60 })
    // Wait for the one commit to settle before comparing, so both sides are read in the same state.
    await expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')
    await expect
      .poll(async () => (await pair('padding-top', 'padding-bottom'))[0]!)
      .toBeGreaterThan(padTop0! + 40)
    const [padTop, padBottom] = await pair('padding-top', 'padding-bottom')
    expect(padBottom! - padBottom0!).toBeCloseTo(padTop! - padTop0!, 0)
    // The drag tracks the pointer: ~60 screen px up is ~60/zoom CSS px of extra padding.
    expect(padTop! - padTop0!).toBeGreaterThan((60 / zoom) * 0.6)
    expect(padTop! - padTop0!).toBeLessThan((60 / zoom) * 1.4)
    // One commit = one write and one undo step that restores BOTH sides.
    expect(writes).toBe(before + 1)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(() => value('padding-top')).toBeCloseTo(padTop0!, 0)
    await expect.poll(() => value('padding-bottom')).toBeCloseTo(padBottom0!, 0)

    // Alt drag moves only the dragged side: left grows, right is untouched.
    const padLeft0 = await value('padding-left')
    const padRight0 = await value('padding-right')
    await drag('.handle.padding.left', { dx: -60 }, true)
    await expect.poll(() => value('padding-left')).toBeGreaterThan(padLeft0 + 40)
    expect(await value('padding-right')).toBeCloseTo(padRight0, 0)
    await expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(() => value('padding-left')).toBeCloseTo(padLeft0, 0)

    // A margin handle writes margin-* the same way, symmetric by default.
    const [marginTop0, marginBottom0] = await pair('margin-top', 'margin-bottom')
    await drag('.handle.margin.top', { dy: -50 })
    await expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')
    await expect
      .poll(async () => (await pair('margin-top', 'margin-bottom'))[0]!)
      .toBeGreaterThan(marginTop0! + 30)
    const [marginTop, marginBottom] = await pair('margin-top', 'margin-bottom')
    expect(marginBottom! - marginBottom0!).toBeCloseTo(marginTop! - marginTop0!, 0)

    expect(errors).toEqual([])
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 60000)
