import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer as tcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Document } from '@freeflow/schema'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createServer } from '../src/app.js'

it('creates a spacing token, binds a field to it, snaps a handle to it, detaches and publishes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-tokens-'))
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
    publishBaseURL: 'http://localhost:3103',
    secret: 'tokens-test-7d2a91c4e0b8f35a6c1e29',
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
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Tokens test')
    await page.getByLabel('Email', { exact: true }).fill('tokens@example.test')
    await page.getByLabel('Password', { exact: true }).fill('tokens-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Tokens')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
    const cta = canvas.locator('[data-freeflow-node="n-home-cta"]')
    await cta.waitFor()

    const saved = () =>
      expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')
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
    const document = async () =>
      (
        (await (await api(`/api/sites/${(await site()).id}/document`)).json()) as {
          document: Document
        }
      ).document
    // The CTA's own padding declaration for one side, read from the saved document.
    const ctaPadding = async (side: string) => {
      const doc = await document()
      return Object.values(doc.styles).find(
        (style) =>
          style.property === `padding-${side}` &&
          doc.nodes['n-home-cta']!.classes.includes(style.class),
      )?.value
    }
    // All four computed sides in one snapshot, so a comparison can't catch them mid-commit.
    const padding = () =>
      cta.evaluate((element) => {
        const style = getComputedStyle(element)
        return (['top', 'right', 'bottom', 'left'] as const).map((side) =>
          Number.parseFloat(style.getPropertyValue(`padding-${side}`)),
        )
      })

    // Create space.card at 20px in the Spacing group of the Design tokens dialog.
    const tokens = page.getByRole('dialog', { name: 'Design tokens' })
    await page.getByRole('button', { name: 'Design tokens', exact: true }).click()
    await tokens.getByRole('button', { name: 'Spacing', exact: true }).click()
    await tokens.getByLabel('Token name', { exact: true }).fill('Card')
    await tokens.getByLabel('Token value', { exact: true }).fill('20px')
    await tokens.getByRole('button', { name: 'Create token', exact: true }).click()
    await tokens.getByRole('heading', { name: 'space.card', exact: true }).waitFor()
    const card = Object.values((await document()).designTokens).find(
      (token) => token.name === 'space.card',
    )!
    expect(card).toMatchObject({ group: 'spacing', values: { light: { value: 20, unit: 'px' } } })
    await tokens.getByRole('button', { name: 'Close tokens', exact: true }).click()

    // Bind the top padding from the ribbon: the field shows the token, the canvas its value.
    await cta.click()
    await page.getByRole('button', { name: 'Layout', exact: true }).click()
    const ribbon = page.locator('.ribbon-controls')
    const top = ribbon.getByLabel('Inside spacing top', { exact: true })
    const pickToken = async (side: string, name: string) => {
      await ribbon.getByRole('button', { name: `Use a token for Inside spacing ${side}` }).click()
      await page
        .getByRole(name === 'Detach' ? 'menuitem' : 'menuitemradio', {
          name: new RegExp(`^${name}`),
        })
        .click()
    }
    await pickToken('top', 'card')
    await expect.poll(() => top.inputValue()).toBe('card')
    await expect.poll(async () => (await padding())[0]).toBe(20)
    await expect.poll(() => ctaPadding('top')).toEqual({ type: 'designToken', ref: card.id })
    await saved()

    // Changing the token moves the canvas without touching the element.
    await page.getByRole('button', { name: 'Design tokens', exact: true }).click()
    await tokens.getByRole('button', { name: 'Spacing', exact: true }).click()
    await tokens.getByRole('button', { name: /^card/ }).click()
    await tokens.getByLabel('Token value', { exact: true }).fill('32px')
    await expect.poll(async () => (await padding())[0]).toBe(32)
    await expect.poll(() => tokens.getByRole('status').textContent()).toBe('All changes saved')
    await tokens.getByRole('button', { name: 'Close tokens', exact: true }).click()
    await expect
      .poll(async () => (await document()).designTokens[card.id]!.values.light)
      .toEqual({ type: 'unit', value: 32, unit: 'px' })
    expect(await ctaPadding('top')).toEqual({ type: 'designToken', ref: card.id })

    // Linked, a pick binds all four sides.
    await ribbon.getByLabel('Link inside spacing', { exact: true }).check()
    await pickToken('bottom', 'card')
    await expect.poll(padding).toEqual([32, 32, 32, 32])
    await saved()
    await mkdir(path.join(root, '.freeflow/editor-preview'), { recursive: true })
    await page.screenshot({ path: path.join(root, '.freeflow/editor-preview/design-tokens.png') })

    // A drag that ends within 4px of the token snaps to it: the readout names it and both sides
    // of the symmetric drag commit the reference.
    const zoom = await page
      .locator('iframe[title="Site canvas"]')
      .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
    // Spacing nubs show in spacing mode, switched on by the chip in the selection's top bar.
    const spacingChip = canvas.getByRole('button', { name: 'Spacing', exact: true })
    await spacingChip.click()
    await expect.poll(() => spacingChip.getAttribute('aria-pressed')).toBe('true')
    const cdp = await context.newCDPSession(page)
    const drag = async (cssDy: number, modifiers = 0) => {
      const nub = canvas.locator('.handle.padding.top')
      await nub.waitFor()
      const box = (await nub.boundingBox())!
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      const to = { x: from.x, y: from.y + cssDy * zoom }
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from })
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...from,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      })
      for (let step = 1; step <= 5; step++)
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          x: from.x,
          y: from.y + ((to.y - from.y) * step) / 5,
          button: 'left',
          buttons: 1,
          modifiers,
        })
      const readout = await canvas.locator('.tag').textContent()
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...to,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      })
      return readout
    }
    expect(await drag(-3)).toBe('space.card')
    await saved()
    await expect.poll(() => ctaPadding('bottom')).toEqual({ type: 'designToken', ref: card.id })
    expect(await ctaPadding('top')).toEqual({ type: 'designToken', ref: card.id })
    await expect.poll(() => top.inputValue()).toBe('card')

    // Published CSS carries the token on :root and the reference as var().
    const { id, revision } = await site()
    const release = (await (
      await api(`/api/sites/${id}/releases`, { expectedRevision: revision, publishedId: null })
    ).json()) as { id: string }
    type History = { url: string; releases: { id: string; status: string }[] }
    const history = async () => (await (await api(`/api/sites/${id}/releases`)).json()) as History
    await expect
      .poll(async () => (await history()).releases.find((row) => row.id === release.id)?.status, {
        timeout: 60_000,
      })
      .toBe('ready')
    const live = (await history()).url
    const html = await (await server.published!.request(live)).text()
    const stylesheet = html.match(/href="(\/(?:_astro|assets)\/[^" ]+\.css)"/)?.[1]
    expect(stylesheet).toBeTruthy()
    const css = await (await server.published!.request(live + stylesheet)).text()
    expect(css).toMatch(/:root\{[^}]*--space-card:32px/)
    expect(css).toContain('var(--space-card)')

    // Detach writes the token's value to the linked sides as plain pixels.
    await pickToken('top', 'Detach')
    await expect.poll(() => top.inputValue()).toBe('32')
    await expect.poll(() => ctaPadding('top')).toEqual({ type: 'unit', value: 32, unit: 'px' })
    await saved()
    expect(await ctaPadding('left')).toEqual({ type: 'unit', value: 32, unit: 'px' })

    // With Ctrl held nothing snaps, even within 4px of the token.
    expect(await drag(2, 2)).toBe('30px')
    await expect.poll(() => ctaPadding('top')).toEqual({ type: 'unit', value: 30, unit: 'px' })
    await saved()
    expect(await padding()).toEqual([30, 32, 30, 32])

    // The text toolbar's typography fields bind to typography tokens the same way.
    await page.getByRole('button', { name: 'Design tokens', exact: true }).click()
    await tokens.getByRole('button', { name: 'Typography', exact: true }).click()
    await tokens.getByLabel('Token name', { exact: true }).fill('body-size')
    await tokens.getByLabel('Token value', { exact: true }).fill('18px')
    await tokens.getByRole('button', { name: 'Create token', exact: true }).click()
    await tokens.getByRole('heading', { name: 'font.body-size', exact: true }).waitFor()
    await tokens.getByRole('button', { name: 'Close tokens', exact: true }).click()
    const bodySize = Object.values((await document()).designTokens).find(
      (token) => token.name === 'font.body-size',
    )!
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    const toolbar = page.getByRole('region', { name: 'Text formatting' })
    await toolbar.getByRole('button', { name: 'Use a token for Size' }).click()
    await page.getByRole('menuitemradio', { name: /^body-size/ }).click()
    await expect
      .poll(() => toolbar.getByLabel('Size', { exact: true }).inputValue())
      .toBe('body-size')
    await expect
      .poll(() => cta.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe('18px')
    await expect
      .poll(async () => {
        const doc = await document()
        return Object.values(doc.styles).find(
          (style) =>
            style.property === 'font-size' &&
            doc.nodes['n-home-cta']!.classes.includes(style.class),
        )?.value
      })
      .toEqual({ type: 'designToken', ref: bodySize.id })
    await saved()

    expect(errors).toEqual([])
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 180_000)
