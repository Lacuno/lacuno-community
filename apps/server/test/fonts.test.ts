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

it('uploads a font in site settings, picks it in the Font control and publishes it self-hosted', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-fonts-'))
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
    publishBaseURL: 'http://localhost:3104',
    secret: 'fonts-test-secret-3f8a61c0d94b27e5a1c8',
    allowSignup: true,
  })
  const listener = serve({ fetch: server.app.fetch, port: address.port, hostname: '127.0.0.1' })
  if (!listener.listening) await once(listener, 'listening')
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.setDefaultTimeout(8000)
    const saved = () =>
      expect
        .poll(() => page.locator('.save-state').textContent(), { timeout: 8000 })
        .toBe('All changes saved')
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Fonts test')
    await page.getByLabel('Email', { exact: true }).fill('fonts@example.test')
    await page.getByLabel('Password', { exact: true }).fill('fonts-test-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Fonts site')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
    const heading = canvas.locator('[data-freeflow-node="n-home-title"]')
    await heading.waitFor()

    // A stub WOFF2: the server types it by its signature; browsers cannot parse it, so the
    // test checks the CSS and the computed family rather than a loaded face.
    await page.getByRole('button', { name: 'Pages', exact: true }).click()
    await page.getByRole('button', { name: 'Site settings', exact: true }).click()
    const site = page.getByRole('dialog', { name: 'Site settings' })
    await site.getByLabel('Upload font', { exact: true }).setInputFiles({
      name: 'TestSans-Bold.woff2',
      mimeType: '',
      buffer: Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60)]),
    })
    const form = site.locator('.font-form')
    expect(await form.getByLabel('Family', { exact: true }).inputValue()).toBe('TestSans')
    expect(await form.getByLabel('Weight', { exact: true }).inputValue()).toBe('700')
    await form.getByLabel('Family', { exact: true }).fill('Test Sans')
    await form.getByRole('button', { name: 'Add', exact: true }).click()
    await saved()
    await site.getByRole('button', { name: 'Remove Test Sans Bold', exact: true }).waitFor()
    await expect.poll(() => site.locator('.font-face').allTextContents()).toContain('Bold×')
    await mkdir(path.join(root, '.freeflow/editor-preview'), { recursive: true })
    await page.screenshot({ path: path.join(root, '.freeflow/editor-preview/site-fonts.png') })
    await site.getByRole('button', { name: 'Close', exact: true }).click()

    const value = '"Test Sans", sans-serif'
    const stacks = ['system-ui, sans-serif', 'Georgia, serif', 'ui-monospace, monospace']
    const font = page.getByLabel('Font', { exact: true })
    const options = () => font.locator('option').allTextContents()
    await heading.click()
    expect(await options()).toEqual(['Inherited', 'Arial, Helvetica, sans-serif', value, ...stacks])
    await font.selectOption(value)
    await saved()
    await expect
      .poll(() =>
        heading.evaluate((el) => getComputedStyle(el.querySelector('span') ?? el).fontFamily),
      )
      .toMatch(/^"Test Sans"/)
    expect(
      await canvas
        .locator('style')
        .evaluateAll((styles) => styles.map((style) => style.textContent).join('')),
    ).toContain('font-family:"Test Sans"')

    const cookie = (await context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ')
    const api = (route: string, body?: unknown) =>
      server.app.request(origin + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    const { id, revision } = (
      (await (await api('/api/sites')).json()) as { sites: { id: string; revision: number }[] }
    ).sites[0]!
    const document = await (await api(`/api/sites/${id}/document`)).text()
    expect(document).toContain(JSON.stringify(value).slice(1, -1))
    type History = { publishedId: string | null; url: string }
    const history = async () => (await (await api(`/api/sites/${id}/releases`)).json()) as History
    const release = (await (
      await api(`/api/sites/${id}/releases`, { expectedRevision: revision, publishedId: null })
    ).json()) as { id: string }
    await expect
      .poll(async () => (await history()).publishedId, { timeout: 60_000 })
      .toBe(release.id)
    const live = (await history()).url
    const home = await (await server.published!.request(`${live}/`)).text()
    const href = home.match(/<link rel="preload" as="font" type="font\/woff2" href="([^"]+)"/)?.[1]
    expect(href).toMatch(/\.woff2$/)
    expect(home).toContain(
      `@font-face{font-family:"Test Sans";src:url("${href}") format("woff2");font-weight:700;font-style:normal;font-display:swap}`,
    )
    const file = await server.published!.request(`${live}${href}`)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('font/woff2')

    // Removing the face drops the family from the list; the heading keeps its value.
    await page.getByRole('button', { name: 'Site settings', exact: true }).click()
    await site.getByRole('button', { name: 'Remove Test Sans Bold', exact: true }).click()
    await saved()
    await expect.poll(() => site.locator('.font-list').textContent()).not.toContain('Test Sans')
    await site.getByRole('button', { name: 'Close', exact: true }).click()
    await heading.click()
    expect(await font.inputValue()).toBe(value)
    expect(await options()).toEqual(['Inherited', value, 'Arial, Helvetica, sans-serif', ...stacks])
    expect(errors).toEqual([])
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 240_000)
