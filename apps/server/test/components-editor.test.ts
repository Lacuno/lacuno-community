import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer as tcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Document } from '@freeflow/schema'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createServer } from '../src/app.js'

it('creates, customizes, edits and detaches reusable components through distinct controls', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-components-'))
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
    secret: 'components-test-795acb4894a5408db9dd23b57f',
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
    await page.getByLabel('Your name').fill('Components test')
    await page.getByLabel('Email', { exact: true }).fill('components@example.test')
    await page.getByLabel('Password', { exact: true }).fill('components-test-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Components test')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    const canvas = page.frameLocator('iframe[title="Site canvas"]')
    await canvas.locator('[data-freeflow-node="n-home-hero-note"]').dispatchEvent('click')
    const siteId = new URL(page.url()).searchParams.get('site')!
    const snapshot = async (): Promise<Document> => {
      const response = await context.request.get(`${origin}/api/sites/${siteId}/document`)
      return (await response.json()).document
    }
    await page.getByRole('button', { name: 'Components', exact: true }).click()
    const rail = page.getByRole('navigation', { name: 'Editor panels' })
    const collapsedWidth = (await rail.boundingBox())!.width
    const content = page.getByRole('region', { name: 'Components panel' })
    const contentWidth = (await content.boundingBox())!.width
    await page.getByRole('button', { name: 'Expand sidebar labels' }).click()
    expect(await rail.getByRole('button', { name: 'Components', exact: true }).textContent()).toBe(
      'Components',
    )
    expect((await rail.boundingBox())!.width).toBeGreaterThan(collapsedWidth)
    expect((await content.boundingBox())!.width).toBe(contentWidth)
    await page.screenshot({
      path: path.join(root, '.freeflow/editor-preview/sidebar-expanded.png'),
    })
    await page.getByRole('button', { name: 'Collapse sidebar labels' }).click()
    expect((await rail.boundingBox())!.width).toBe(collapsedWidth)
    expect(
      await rail
        .getByRole('button', { name: 'Components', exact: true })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    await page.getByRole('button', { name: 'Create component…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Create component', exact: true })
    await dialog.getByLabel('Name', { exact: true }).fill('Promo panel')
    await dialog.getByText('Allow instance-specific text', { exact: true }).click()
    await dialog.getByRole('checkbox').first().check()
    await page.screenshot({
      path: path.join(root, '.freeflow/editor-preview/component-create.png'),
    })
    await dialog.getByRole('button', { name: 'Create component', exact: true }).click()
    await expect.poll(() => dialog.count()).toBe(0)
    const extracted = await snapshot()
    const component = Object.values(extracted.components).find(
      (item) => item.name === 'Promo panel',
    )!
    expect(component).toBeDefined()
    const instance = Object.values(extracted.nodes).find(
      (node) => node.type === 'component' && node.component === component.id,
    )!
    await expect.poll(() => canvas.locator(`[data-freeflow-node="${instance.id}"]`).count()).toBe(1)
    expect(await canvas.locator('[data-freeflow-node="n-home-note-top"]').count()).toBe(0)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await snapshot()).components[component.id]).toBeUndefined()
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect
      .poll(async () => (await snapshot()).components[component.id]?.name)
      .toBe('Promo panel')
    await canvas.locator(`[data-freeflow-node="${instance.id}"]`).dispatchEvent('click')
    await page.getByLabel(component.props[0]!.label!, { exact: true }).fill('Only this instance')
    await expect
      .poll(async () => {
        const node = (await snapshot()).nodes[instance.id]
        return node?.type === 'component' ? node.props?.[component.props[0]!.name] : null
      })
      .toEqual({ type: 'static', value: 'Only this instance' })
    await page.screenshot({
      path: path.join(root, '.freeflow/editor-preview/component-instance.png'),
    })
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    expect(
      await page.getByRole('button', { name: 'Insert Promo panel', exact: true }).count(),
    ).toBe(0)
    await page.getByRole('button', { name: 'Components', exact: true }).click()
    await expect
      .poll(() => page.getByRole('button', { name: 'Create component…', exact: true }).isDisabled())
      .toBe(true)
    await page.screenshot({ path: path.join(root, '.freeflow/editor-preview/components-tab.png') })
    await page.getByRole('button', { name: 'Insert Promo panel', exact: true }).click()
    await expect
      .poll(
        async () =>
          Object.values((await snapshot()).nodes).filter(
            (node) => node.type === 'component' && node.component === component.id,
          ).length,
      )
      .toBe(2)
    await page.getByRole('button', { name: 'Edit shared component', exact: true }).click()
    await expect
      .poll(() => canvas.locator('[data-freeflow-node="n-home-note-copy"]').count())
      .toBe(1)
    await canvas.locator('[data-freeflow-node="n-home-note-copy"]').click()
    await page.getByLabel('Text', { exact: true }).fill('Shared text changed on the canvas')
    await expect
      .poll(async () => {
        const node = (await snapshot()).nodes['n-home-note-copy']
        return node?.type === 'text' ? node.text : null
      })
      .toEqual({ type: 'static', value: 'Shared text changed on the canvas' })
    await page.screenshot({
      path: path.join(root, '.freeflow/editor-preview/component-shared.png'),
    })
    await page.getByRole('button', { name: 'Component settings…', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Component settings', exact: true })
    await settings.getByLabel(component.props[0]!.label!, { exact: true }).fill('Shared default')
    await settings.getByRole('button', { name: 'Save component settings', exact: true }).click()
    await expect.poll(() => settings.count()).toBe(0)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect
      .poll(() => canvas.getByText('Shared text changed on the canvas', { exact: true }).count())
      .toBe(2)
    await expect.poll(() => canvas.getByText('Only this instance', { exact: true }).count()).toBe(1)
    await expect.poll(() => canvas.getByText('Shared default', { exact: true }).count()).toBe(1)
    await canvas.locator(`[data-freeflow-node="${instance.id}"]`).dispatchEvent('click')
    await page.getByText('Instance actions', { exact: true }).click()
    await page.getByRole('button', { name: 'Detach from component…' }).click()
    const detach = page.getByRole('dialog', { name: 'Detach component', exact: true })
    await detach.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await snapshot()).nodes[instance.id]?.type).toBe('component')
    await page.getByRole('button', { name: 'Detach from component…' }).click()
    await detach.getByRole('button', { name: 'Detach component', exact: true }).click()
    await expect.poll(async () => (await snapshot()).nodes[instance.id]).toBeUndefined()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(async () => (await snapshot()).nodes[instance.id]?.type).toBe('component')
    await page.reload()
    await expect.poll(() => canvas.getByText('Only this instance', { exact: true }).count()).toBe(1)
    await expect.poll(() => canvas.getByText('Shared default', { exact: true }).count()).toBe(1)
    expect(errors).toEqual([])
  } finally {
    await browser.close()
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    )
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 40000)
