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

it('edits a real template in the browser, persists changes, and protects drafts on conflict', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-editor-'))
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
    secret: 'editor-test-795acb4894a5408db9dd23b57f',
    allowSignup: true,
  })
  const listener = serve({ fetch: server.app.fetch, port: address.port, hostname: '127.0.0.1' })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('Editor test')
    await page.getByLabel('Email', { exact: true }).fill('editor@example.test')
    await page.getByLabel('Password', { exact: true }).fill('editor-test-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('A place to make things')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
    await canvas.locator('[data-freeflow-node="n-home-title"]').waitFor()
    const heading = canvas.locator('[data-freeflow-node="n-home-title"]')
    await heading.click()
    await page.getByLabel('Text', { exact: true }).fill('Made with Freeflow.')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect.poll(() => heading.textContent()).toBe('Made with Freeflow.')
    await page.getByLabel('Value', { exact: true }).fill('42px')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe('42px')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
      .not.toBe('42px')
    expect(await heading.textContent()).toBe('Made with Freeflow.')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(() => heading.textContent()).toBe('Your website. Your rules.')
    await expect
      .poll(() => page.getByRole('button', { name: 'Undo', exact: true }).isDisabled())
      .toBe(true)
    await page.getByRole('button', { name: 'Redo', exact: true }).focus()
    await page.keyboard.press('Control+Shift+Z')
    await expect.poll(() => heading.textContent()).toBe('Made with Freeflow.')
    await heading.click()
    await page.keyboard.press('Control+Shift+Z')
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe('42px')
    await page.getByLabel('Text', { exact: true }).focus()
    await page.keyboard.press('End')
    await page.keyboard.type('!')
    await expect
      .poll(() => page.getByRole('button', { name: 'Undo', exact: true }).isDisabled())
      .toBe(true)
    await page.keyboard.press('ControlOrMeta+Z')
    await expect
      .poll(() => page.getByLabel('Text', { exact: true }).inputValue())
      .toBe('Made with Freeflow.')
    await expect
      .poll(() => page.getByRole('button', { name: 'Undo', exact: true }).isEnabled())
      .toBe(true)
    await page.reload()
    await expect.poll(() => heading.textContent()).toBe('Made with Freeflow.')
    await expect
      .poll(() => page.getByRole('button', { name: 'Undo', exact: true }).isDisabled())
      .toBe(true)
    expect(await page.getByRole('button', { name: 'Redo', exact: true }).isDisabled()).toBe(true)
    await page.locator('.layer').filter({ hasText: /h1$/ }).click()
    expect(await page.getByLabel('Text', { exact: true }).inputValue()).toBe('Made with Freeflow.')
    await page.getByLabel('Text', { exact: true }).fill('Unsaved draft')
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.locator('.page-link').filter({ hasText: 'About' }).click()
    expect(await page.getByLabel('Text', { exact: true }).inputValue()).toBe('Unsaved draft')
    const siteId = new URL(page.url()).searchParams.get('site')!
    const snapshotResponse = await context.request.get(`${origin}/api/sites/${siteId}/document`)
    const snapshot = await snapshotResponse.json()
    const concurrent = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
      data: {
        expectedRevision: snapshot.revision,
        operations: [
          {
            type: 'site.update',
            name: 'Updated elsewhere',
            bodyCode: '<script>parent.document.title="UNSAFE"</script>',
          },
        ],
      },
    })
    expect(concurrent.status()).toBe(200)
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.getByRole('button', { name: 'Reload latest', exact: true }).waitFor()
    expect(await page.getByLabel('Text', { exact: true }).inputValue()).toBe('Unsaved draft')
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Reload latest', exact: true }).click()
    await expect
      .poll(() => page.getByLabel('Text', { exact: true }).inputValue())
      .toBe('Made with Freeflow.')
    await expect.poll(() => heading.textContent()).toBe('Made with Freeflow.')
    expect(await page.title()).toBe('Freeflow — Editor')
    await page.getByLabel('Text', { exact: true }).fill('Temporary undo target')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect.poll(() => heading.textContent()).toBe('Temporary undo target')
    const beforeUndo = await (
      await context.request.get(`${origin}/api/sites/${siteId}/document`)
    ).json()
    expect(
      (
        await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
          data: {
            expectedRevision: beforeUndo.revision,
            operations: [
              {
                type: 'node.update',
                id: 'n-home-title',
                text: { type: 'static', value: 'Other session wins' },
              },
            ],
          },
        })
      ).status(),
    ).toBe(200)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await page.getByRole('button', { name: 'Reload latest', exact: true }).click()
    await expect.poll(() => heading.textContent()).toBe('Other session wins')
    await expect
      .poll(() => page.getByRole('button', { name: 'Undo', exact: true }).isDisabled())
      .toBe(true)
    // Links select elements rather than leaving the canvas.
    await canvas.locator('a').first().click()
    await heading.waitFor()
    await page.getByRole('button', { name: 'Mobile', exact: true }).click()
    const frame = page.frames().find((item) => item.url() === 'about:srcdoc')!
    expect(await frame.evaluate(() => innerWidth)).toBe(390)
    expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    )
    await page.locator('.page-link').filter({ hasText: 'Article' }).click()
    await page.getByLabel('Collection entry').selectOption({ index: 1 })
    await canvas.locator('h1').waitFor()
    await page.locator('.page-link').filter({ hasText: 'Home' }).click()
    await heading.waitFor()
    await page.getByRole('button', { name: 'Desktop', exact: true }).click()
    await heading.click()
    await page.getByText('Add element', { exact: true }).click()
    await page.getByRole('button', { name: 'Insert element', exact: true }).click()
    const inserted = canvas.getByRole('heading', { name: 'Your new heading', exact: true })
    await inserted.waitFor()
    const insertedId = await inserted.getAttribute('data-freeflow-node')
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(() => inserted.count()).toBe(0)
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await inserted.waitFor()
    expect(await inserted.getAttribute('data-freeflow-node')).toBe(insertedId)
    await expect
      .poll(() => page.getByRole('button', { name: 'Move up', exact: true }).isEnabled())
      .toBe(true)
    await page.getByRole('button', { name: 'Move up', exact: true }).click()
    const readInsertedPosition = async () => {
      const snapshot = await (
        await context.request.get(`${origin}/api/sites/${siteId}/document`)
      ).json()
      const node = snapshot.document.nodes[insertedId!]
      const siblings = snapshot.document.nodes[node.parent].children
      return siblings.indexOf(insertedId) - siblings.length
    }
    await expect.poll(readInsertedPosition).toBe(-2)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(readInsertedPosition).toBe(-1)
    await page.getByRole('button', { name: 'Reload site', exact: true }).click()
    await inserted.waitFor()
    await page.mouse.move(0, 0)
    await mkdir(path.join(root, '.freeflow/editor-preview'), { recursive: true })
    await page.screenshot({ path: path.join(root, '.freeflow/editor-preview/editor-desktop.png') })
    expect(errors).toEqual([])
    await page.getByRole('button', { name: 'Back to sites' }).click()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.getByLabel('Email', { exact: true }).fill('editor@example.test')
    await page.getByLabel('Password', { exact: true }).fill('editor-test-password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('button', { name: /Updated elsewhere/ }).waitFor()
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 60_000)
