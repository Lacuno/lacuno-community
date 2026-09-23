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

it('binds per-side spacing inputs to the longhands and the handles, with a chain per pair of sides', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-per-side-'))
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
    secret: 'per-side-test-9f2a41cb7d264f8091ce7f1a2b3c',
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
    await page.getByLabel('Your name').fill('Per side test')
    await page.getByLabel('Email', { exact: true }).fill('per-side@example.test')
    await page.getByLabel('Password', { exact: true }).fill('per-side-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Per side')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const cta = canvas.locator('[data-freeflow-node="n-home-cta"]')
    await cta.waitFor()
    await cta.click()
    await page.getByRole('button', { name: 'Layout', exact: true }).click()

    const ribbon = page.locator('.ribbon-controls')
    const saved = () =>
      expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')
    // Read the four computed sides in one snapshot so a comparison can't catch them mid-commit.
    const padding = () =>
      cta.evaluate((element) => {
        const style = getComputedStyle(element)
        return (['top', 'right', 'bottom', 'left'] as const).map((side) =>
          Number.parseFloat(style.getPropertyValue(`padding-${side}`)),
        )
      })
    const initial = await padding()

    // The button's padding is symmetric per pair, so both chains start pressed: editing one side
    // moves the opposite side too, in a single write / undo step.
    const chain = (pair: string) =>
      ribbon.getByRole('button', { name: `Link inside spacing ${pair}`, exact: true })
    for (const pair of ['top and bottom', 'left and right'])
      await expect.poll(() => chain(pair).getAttribute('aria-pressed')).toBe('true')
    for (const [side, value, expected] of [
      ['top', '30', [30, initial[1], 30, initial[3]]],
      ['left', '40', [initial[0], 40, initial[2], 40]],
    ] as const) {
      const before = writes
      await ribbon.getByLabel(`Inside spacing ${side}`, { exact: true }).fill(value)
      await expect.poll(padding).toEqual(expected)
      await saved()
      expect(writes).toBe(before + 1)
      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect.poll(padding).toEqual(initial)
      await saved()
    }

    // Chain off: editing one side moves only that side.
    await chain('left and right').click()
    await ribbon.getByLabel('Inside spacing left', { exact: true }).fill('40')
    await expect.poll(padding).toEqual([initial[0], initial[1], initial[2], 40])
    await saved()

    // Any length keeps its unit: a rem side reads back as rem, not as a bare pixel count.
    const topInput = ribbon.getByLabel('Inside spacing top', { exact: true })
    await topInput.fill('1.5rem')
    await expect.poll(padding).toEqual([24, initial[1], 24, 40])
    await saved()
    await expect.poll(() => topInput.inputValue()).toBe('1.5rem')

    await mkdir(path.join(root, '.freeflow/editor-preview'), { recursive: true })
    await ribbon.locator('.spacing-controls').screenshot({
      path: path.join(root, '.freeflow/editor-preview/spacing-ribbon.png'),
    })

    // Dragging a padding handle updates the matching side input live, before the commit lands.
    const zoom = await page
      .locator('iframe[title="Site canvas"]')
      .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
    // Spacing nubs show in spacing mode, switched on by the chip in the selection's top bar.
    const spacingChip = canvas.getByRole('button', { name: 'Spacing', exact: true })
    await spacingChip.click()
    await expect.poll(() => spacingChip.getAttribute('aria-pressed')).toBe('true')
    const nub = canvas.locator('.handle.padding.top')
    await nub.waitFor()
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
    // Ctrl keeps the drag off the template's spacing tokens, so the input shows a number.
    for (let step = 1; step <= 15; step++)
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: from.x,
        y: from.y - (50 * step) / 15,
        button: 'left',
        buttons: 1,
        modifiers: 2,
      })
    // The input tracks the draft while the pointer is still down (autosave paused).
    await expect
      .poll(() => topInput.inputValue().then(Number.parseFloat))
      .toBeGreaterThan((50 / zoom) * 0.6)
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: from.x,
      y: from.y - 50,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    await saved()
    expect((await padding())[0]!).toBeGreaterThan((50 / zoom) * 0.6)

    expect(errors).toEqual([])
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 60000)
