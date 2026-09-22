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

it('drags on-canvas size handles: 1:1 width, one-step corner, Shift ratio, clears max caps and flex shrink', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-size-'))
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
    secret: 'size-test-8a41c2d95e7b4f03a6d1e2c9b7f0',
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
    await page.getByLabel('Your name').fill('Size test')
    await page.getByLabel('Email', { exact: true }).fill('size@example.test')
    await page.getByLabel('Password', { exact: true }).fill('size-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Size')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const cta = canvas.locator('[data-freeflow-node="n-home-cta"]')
    await cta.waitFor()
    await cta.click()

    // Iframe transform scale: the pointer maps to CSS px through it, so a screen drag of d moves
    // the edge d/zoom CSS px (the handle math uses the iframe's own coordinates, no division).
    const zoom = await page
      .locator('iframe[title="Site canvas"]')
      .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
    expect(zoom).toBeLessThan(1)

    const cdp = await context.newCDPSession(page)
    const drag = async (
      handle: string,
      move: { dx?: number; dy?: number },
      modifiers = 0,
    ): Promise<void> => {
      const nub = canvas.locator(handle)
      await nub.waitFor()
      const box = (await nub.boundingBox())!
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      const dx = move.dx ?? 0
      const dy = move.dy ?? 0
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

    // Read the rendered border box and the written sizes in one snapshot, never mid-commit.
    const size = () =>
      cta.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return { w: box.width, h: box.height, width: style.width, height: style.height }
      })
    const saved = () =>
      expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')
    const undo = () => page.getByRole('button', { name: 'Undo', exact: true }).click()

    // The right handle sets width only; the rendered box follows the pointer 1:1 in CSS px.
    const start = await size()
    let before = writes
    await drag('.handle.size.right', { dx: 60 })
    await saved()
    await expect.poll(async () => (await size()).w).toBeGreaterThan(start.w + 30)
    const wide = await size()
    expect(wide.w - start.w).toBeCloseTo(60 / zoom, 0)
    expect(wide.h).toBeCloseTo(start.h, 0)
    expect(writes).toBe(before + 1)

    // The corner sets width and height in one write, and one Undo restores both.
    before = writes
    await drag('.handle.size.corner', { dx: 40, dy: 30 })
    await saved()
    await expect.poll(async () => (await size()).h).toBeGreaterThan(wide.h + 20)
    const corner = await size()
    expect(corner.w - wide.w).toBeCloseTo(40 / zoom, 0)
    expect(corner.h - wide.h).toBeCloseTo(30 / zoom, 0)
    expect(writes).toBe(before + 1)
    await undo()
    await saved()
    await expect.poll(async () => (await size()).h).toBeLessThan(wide.h + 1)
    const undone = await size()
    expect(undone.w).toBeCloseTo(wide.w, 0)
    expect(undone.h).toBeCloseTo(wide.h, 0)

    // Shift on the corner keeps the aspect ratio: the larger relative change leads.
    await drag('.handle.size.corner', { dx: 80, dy: 5 }, 8)
    await saved()
    await expect.poll(async () => (await size()).w).toBeGreaterThan(undone.w + 40)
    const kept = await size()
    expect(kept.h / kept.w / (undone.h / undone.w)).toBeCloseTo(1, 1)
    expect(kept.h).toBeGreaterThan(undone.h + 5)

    // Adds a site rule to the canvas (PARENT names the CTA's parent), then waits two frames so the
    // overlay has moved the handles to the new box before the next drag reads their position.
    const inject = async (css: string) => {
      await cta.evaluate((element, text) => {
        const style = element.ownerDocument.createElement('style')
        style.textContent = text.replace('PARENT', element.parentElement!.dataset.freeflowNode!)
        element.ownerDocument.head.append(style)
      }, css)
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
    }

    // Under content-box the written width leaves out padding and border, so the rendered box
    // still follows the pointer 1:1.
    await inject('[data-freeflow-node="n-home-cta"] { box-sizing: content-box !important }')
    const content = await size()
    await drag('.handle.size.right', { dx: 60 })
    await saved()
    await expect.poll(async () => (await size()).w).toBeGreaterThan(content.w + 30)
    expect((await size()).w - content.w).toBeCloseTo(60 / zoom, 0)

    // The committed declarations of the CTA's classes, from the saved document.
    const siteId = new URL(page.url()).searchParams.get('site')!
    const committed = async () => {
      const { document: doc } = await context.request
        .get(`${origin}/api/sites/${siteId}/document`)
        .then((response) => response.json())
      const classes: string[] = doc.nodes['n-home-cta'].classes
      return Object.values(
        doc.styles as Record<string, { class: string; property: string; value: unknown }>,
      ).filter((style) => classes.includes(style.class))
    }

    // A max-width cap is cleared by the same drag once the width passes it, in the same commit, and
    // one Undo restores both. The cap has no specificity, like any site rule the local class beats.
    const uncapped = await size()
    await inject(
      `:where([data-freeflow-node="n-home-cta"]) { max-width: ${Math.round(uncapped.w) + 20}px }`,
    )
    const capped = await size()
    expect(capped.w).toBeCloseTo(uncapped.w, 0)
    const beforeCap = await committed()
    before = writes
    await drag('.handle.size.right', { dx: 120 })
    await saved()
    await expect.poll(async () => (await size()).w).toBeGreaterThan(capped.w + 60)
    expect(Math.abs((await size()).w - capped.w - 120 / zoom)).toBeLessThan(1)
    expect(await committed()).toContainEqual(
      expect.objectContaining({ property: 'max-width', value: { type: 'keyword', value: 'none' } }),
    )
    expect(writes).toBe(before + 1)
    await undo()
    await saved()
    await expect.poll(committed).toEqual(beforeCap)
    await expect.poll(async () => (await size()).w).toBeCloseTo(capped.w, 0)

    // In a flex row the element would shrink back into the free space, so a width drag also stops
    // it shrinking: the rendered width follows the pointer and the commit carries flex-shrink: 0.
    await inject(
      '[data-freeflow-node="PARENT"] { display: flex !important; flex-direction: row !important }',
    )
    const row = await cta.evaluate((element) => ({
      shrink: getComputedStyle(element).flexShrink,
      w: element.getBoundingClientRect().width,
    }))
    expect(row.shrink).not.toBe('0')
    await drag('.handle.size.right', { dx: 160 })
    await saved()
    await expect.poll(async () => (await size()).w).toBeGreaterThan(row.w + 100)
    expect(Math.abs((await size()).w - row.w - 160 / zoom)).toBeLessThan(1)
    expect(await committed()).toContainEqual(
      expect.objectContaining({
        property: 'flex-shrink',
        value: { type: 'unit', value: 0, unit: 'number' },
      }),
    )

    expect(errors).toEqual([])
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 60000)
