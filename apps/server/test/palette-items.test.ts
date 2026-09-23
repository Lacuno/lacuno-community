import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer as tcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { chromium, type Locator } from 'playwright'
import { expect, it } from 'vitest'
import { createServer } from '../src/app.js'

it('inserts a list, span, video and embed from the palette and publishes them', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-palette-'))
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
    publishBaseURL: 'http://localhost:3102',
    secret: 'palette-test-5c92df18eb3a07c46f9d28',
    allowSignup: true,
  })
  const listener = serve({ fetch: server.app.fetch, port: address.port, hostname: '127.0.0.1' })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const saved = () =>
      expect
        .poll(() => page.locator('.save-state').textContent(), { timeout: 8000 })
        .toBe('All changes saved')
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Palette test')
    await page.getByLabel('Email', { exact: true }).fill('palette@example.test')
    await page.getByLabel('Password', { exact: true }).fill('palette-test-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Palette items')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
    await canvas.locator('[data-freeflow-node="n-home-cta"]').waitFor()

    const insert = async (name: string) => {
      await page.getByRole('button', { name: 'Add', exact: true }).click()
      await page.getByRole('button', { name, exact: true }).click()
      await page.getByRole('button', { name: 'Insert element', exact: true }).click()
      await saved()
    }
    const editText = async (element: Locator, words: string) => {
      // The selection chrome can cover short text, so the double-click goes to the element itself.
      await element.dispatchEvent('dblclick')
      const editable = canvas.getByLabel('Canvas text editor')
      await editable.waitFor()
      await editable.pressSequentially(words)
      await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
      await saved()
    }

    // A list is a ul of three items; the inspector switches it to numbered in place.
    await insert('List')
    await page.getByLabel('List type', { exact: true }).selectOption('ol')
    await saved()
    const item = canvas.locator('ol > li', { hasText: 'Second item' })
    await item.waitFor()
    await editText(item, ' edited')
    await expect.poll(() => item.textContent()).toBe('Second item edited')

    // A span is inline text, edited like any other text.
    await insert('Span')
    const span = canvas.locator('span[data-freeflow-node]', { hasText: 'Span' })
    await editText(span, ' text')
    await expect.poll(() => span.textContent()).toBe('Span text')

    // A video without a source is a placeholder until an uploaded clip is chosen.
    await page.getByRole('button', { name: 'Assets', exact: true }).click()
    await page.getByLabel('Upload image, video or font', { exact: true }).setInputFiles({
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('AAAAGGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQ==', 'base64'),
    })
    await page.getByRole('button', { name: 'Insert clip.mp4', exact: true }).waitFor()
    await insert('Video')
    await canvas.locator('[data-freeflow-placeholder="Video"]').waitFor()
    await page.getByRole('button', { name: 'Choose video', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Video library' })
      .getByRole('button', { name: 'Choose clip.mp4', exact: true })
      .click()
    await saved()
    await canvas.locator('video[src^="/api/sites/"]').waitFor()
    // Browsers refuse unmuted autoplay, so turning it on mutes the video too. The toggles show
    // the saved attributes, so each click is followed by a save.
    const toggle = async (name: string, checked: boolean) => {
      await page.getByLabel(name, { exact: true }).click()
      await saved()
      await expect.poll(() => page.getByLabel(name, { exact: true }).isChecked()).toBe(checked)
    }
    await toggle('Autoplay', true)
    await expect.poll(() => page.getByLabel('Muted', { exact: true }).isChecked()).toBe(true)
    await toggle('Autoplay', false)
    await toggle('Muted', false)

    // Embed code never runs on the canvas, so an iframe-only embed shows a labelled placeholder.
    await insert('Embed')
    await page.getByRole('button', { name: 'About embed code' }).click()
    await page.getByText('Paste the HTML snippet a service gives you').waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await page
      .getByLabel('Embed code', { exact: true })
      .fill('<iframe src="https://example.com"></iframe>')
    await page.getByLabel('Embed code', { exact: true }).blur()
    await saved()
    await canvas
      .locator('[data-freeflow-placeholder="Embed"] iframe')
      .waitFor({ state: 'attached' })
    // Styling an embed publishes a wrapper that carries its class.
    await page.getByRole('button', { name: 'Layout', exact: true }).click()
    await page
      .locator('.ribbon-controls')
      .getByLabel('Inside spacing top', { exact: true })
      .fill('20')
    await expect
      .poll(() =>
        canvas
          .locator('[data-freeflow-embed]')
          .evaluate((element) => getComputedStyle(element).paddingTop),
      )
      .toBe('20px')
    await saved()

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
    type History = { publishedId: string | null; url: string; releases: { id: string }[] }
    const history = async (id: string) =>
      (await (await api(`/api/sites/${id}/releases`)).json()) as History
    const publish = async () => {
      const { id, revision } = await site()
      const before = await history(id)
      const release = (await (
        await api(`/api/sites/${id}/releases`, {
          expectedRevision: revision,
          publishedId: before.publishedId,
        })
      ).json()) as { id: string }
      await expect
        .poll(async () => (await history(id)).publishedId, { timeout: 60_000 })
        .toBe(release.id)
      const live = (await history(id)).url
      return await (await server.published!.request(`${live}/`)).text()
    }
    const published = await publish()
    expect(published).toMatch(/<ol[^>]*><li[^>]*>First item<\/li><li[^>]*>Second item edited<\/li>/)
    expect(published).toMatch(/<span[^>]*>Span text<\/span>/)
    expect(published).toMatch(
      /<video class="[^"]+" controls playsinline src="\/assets\/[a-f0-9]{64}\.mp4"><\/video>/,
    )
    expect(published).toMatch(
      /<div class="[^"]+"><iframe src="https:\/\/example.com"><\/iframe><\/div>/,
    )
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 240_000)
