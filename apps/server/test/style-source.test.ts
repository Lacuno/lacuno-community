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

it('names where each style field gets its value', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-style-source-'))
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
    secret: 'style-source-test-5c1e93ab7f2d4e60a8b1c2d3',
    allowSignup: true,
  })
  const listener = serve({ fetch: server.app.fetch, port: address.port, hostname: '127.0.0.1' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
    page.setDefaultTimeout(8000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
    const ribbon = page.locator('.ribbon-controls')
    const line = (property: string) => ribbon.locator(`.source[data-source="${property}"]`).first()
    const source = (property: string) => line(property).textContent()
    const saved = () =>
      expect.poll(() => page.locator('.save-state').textContent()).toBe('All changes saved')
    const tab = (name: string) => page.getByRole('button', { name, exact: true }).click()
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Source test')
    await page.getByLabel('Email', { exact: true }).fill('source@example.test')
    await page.getByLabel('Password', { exact: true }).fill('style-source-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Sources')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()

    // The hero heading inherits its font from the page root's site class, through a token.
    const heading = canvas.locator('[data-freeflow-node="n-home-title"]')
    await heading.waitFor()
    await heading.click()
    await expect.poll(() => source('font-family')).toBe('body · inherited')
    // Following an inherited line selects the element that sets the value: the page root, whose
    // own line names its class.
    expect(await line('font-family').getAttribute('aria-label')).toBe('Go to Body')
    await line('font-family').click()
    await expect.poll(() => source('font-family')).toMatch(/^body · class /)
    await heading.click()
    await expect.poll(() => source('font-family')).toBe('body · inherited')
    await ribbon.getByLabel('Font', { exact: true }).selectOption({ index: 2 })
    await expect.poll(() => source('font-family')).toBe('local')
    await saved()
    await page.mouse.move(0, 0)
    await mkdir(path.join(root, '.freeflow/editor-preview'), { recursive: true })
    await page.locator('.editor-ribbon').screenshot({
      path: path.join(root, '.freeflow/editor-preview/style-source-toolbar.png'),
    })
    // Hovering a field shows its truncated source line in full.
    await ribbon.getByLabel('Text color', { exact: true }).hover()
    await page.locator('.editor-ribbon').screenshot({
      path: path.join(root, '.freeflow/editor-preview/style-source-toolbar-hover.png'),
    })

    // The CTA's padding comes from the shared button class until it is set here.
    const cta = canvas.locator('[data-freeflow-node="n-home-cta"]')
    await cta.click()
    await tab('Layout')
    await expect.poll(() => source('padding-top')).toMatch(/^[\d.]+px · class button$/)
    // The Layout tab fits a 1500px window with the design tokens in view.
    await page.locator('.editor-ribbon').screenshot({
      path: path.join(root, '.freeflow/editor-preview/ribbon-layout-1500.png'),
    })
    const ribbonBody = page.locator('.ribbon-body')
    expect(await ribbonBody.evaluate((body) => body.scrollWidth - body.clientWidth)).toBe(0)
    const swatches = await page.locator('.ribbon-swatches').boundingBox()
    expect(swatches!.x + swatches!.width).toBeLessThanOrEqual(1500)
    // The class line highlights the class in the inspector's Classes section.
    expect(await line('padding-top').getAttribute('aria-label')).toBe('Go to class button')
    await line('padding-top').click()
    await expect
      .poll(() => page.locator('.class-manager [data-highlight] summary').textContent())
      .toMatch(/^button /)
    expect(await page.locator('.advanced-classes').getAttribute('open')).not.toBeNull()
    await expect
      .poll(() =>
        ribbon
          .getByRole('button', { name: 'Link inside spacing top and bottom', exact: true })
          .getAttribute('aria-pressed'),
      )
      .toBe('true')
    await ribbon.getByLabel('Inside spacing top', { exact: true }).fill('30')
    await expect.poll(() => source('padding-top')).toMatch(/ · local$/)
    await saved()
    await page.locator('.editor-ribbon').screenshot({
      path: path.join(root, '.freeflow/editor-preview/style-source-spacing.png'),
    })
    await tab('Tablet')
    await expect.poll(() => source('padding-top')).toMatch(/^[\d.]+px · local, Desktop$/)
    await tab('Desktop')

    // A preset made from the link supplies its background, still through the accent token.
    await tab('Home')
    await page.locator('.editor-ribbon').screenshot({
      path: path.join(root, '.freeflow/editor-preview/style-source-home.png'),
    })
    await page.getByRole('button', { name: 'Preset actions', exact: true }).click()
    await page.getByRole('button', { name: 'Create preset from selection', exact: true }).click()
    await page.getByLabel('Preset name', { exact: true }).fill('Call to action')
    await page.getByRole('button', { name: 'Create preset', exact: true }).click()
    await saved()
    await tab('Appearance')
    await expect.poll(() => source('background-color')).toBe('accent · preset Call to action')
    // The preset line opens the preset manager on it.
    expect(await line('background-color').getAttribute('aria-label')).toBe(
      'Go to preset Call to action',
    )
    await line('background-color').click()
    await expect
      .poll(() =>
        page
          .locator('.preset-actions-popover')
          .evaluate((popover) => popover.matches(':popover-open')),
      )
      .toBe(true)
    expect(
      await ribbon
        .getByLabel('Preset', { exact: true })
        .evaluate((select: HTMLSelectElement) => select.selectedOptions[0]?.text),
    ).toBe('Call to action')
    await page.keyboard.press('Escape')

    // Binding a side to a spacing token names the token.
    await tab('Layout')
    await ribbon.getByRole('button', { name: 'Use a token for Inside spacing top' }).click()
    await ribbon.getByRole('menuitemradio', { name: /^md/ }).click()
    await expect.poll(() => source('padding-top')).toBe('md · local')
    await saved()
    // The token line opens the design tokens on Spacing with md selected.
    expect(await line('padding-top').getAttribute('aria-label')).toBe('Go to token md')
    await line('padding-top').click()
    const tokens = page.getByRole('dialog', { name: 'Design tokens' })
    await expect
      .poll(() =>
        tokens.getByRole('button', { name: 'Spacing', exact: true }).getAttribute('aria-pressed'),
      )
      .toBe('true')
    expect(await tokens.locator('.palette-item.active strong').textContent()).toBe('md')
    expect(errors).toEqual([])
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 120_000)
