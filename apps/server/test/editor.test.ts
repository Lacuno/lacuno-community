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
    const saved = () =>
      expect
        .poll(() => page.locator('.save-state').textContent(), { timeout: 8000 })
        .toBe('All changes saved')
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
    await expect.poll(() => heading.textContent()).toBe('Made with Freeflow.')
    expect(await page.getByRole('button', { name: 'Save changes', exact: true }).count()).toBe(0)
    await saved()
    await page.getByLabel('Size', { exact: true }).fill('42px')
    await saved()
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
    await page.getByLabel('Text', { exact: true }).fill('Autosaved on navigation')
    await page.locator('.page-link').filter({ hasText: 'About' }).click()
    await expect.poll(() => page.locator('.page-link.active').textContent()).toContain('About')
    await page.locator('.page-link').filter({ hasText: 'Home' }).click()
    await expect.poll(() => heading.textContent()).toBe('Autosaved on navigation')
    await heading.click()
    await page.getByLabel('Text', { exact: true }).fill('Made with Freeflow.')
    await saved()
    await page.getByLabel('Text', { exact: true }).fill('Unsaved draft')
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
    await saved()
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
    // Formatting a classless element needs no class setup and resets to the original style.
    const originalInsertedSize = await inserted.evaluate(
      (element) => getComputedStyle(element).fontSize,
    )
    await page.getByLabel('Size', { exact: true }).fill('31')
    await saved()
    await expect
      .poll(() => inserted.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe('31px')
    await page.getByRole('button', { name: 'Reset formatting', exact: true }).click()
    await expect
      .poll(() => inserted.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe(originalInsertedSize)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect
      .poll(() => inserted.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe('31px')
    // Classes and project colors retain references through edits, history and reloads.
    await page.getByText('Advanced: shared classes', { exact: true }).click()
    await page.getByText('Assign or create class', { exact: true }).click()
    await page.getByLabel('New class name', { exact: true }).fill('project-color-test')
    await page.getByRole('button', { name: 'Create and assign', exact: true }).click()
    await expect
      .poll(() => page.getByRole('button', { name: 'Project colors', exact: true }).isEnabled())
      .toBe(true)
    await page.getByRole('button', { name: 'Project colors', exact: true }).click()
    const colors = page.getByRole('dialog', { name: 'Project colors' })
    await colors.getByLabel('Color name', { exact: true }).fill('Ocean Test')
    await colors.getByLabel('Color value', { exact: true }).fill('#123456')
    await colors.getByRole('button', { name: 'Create color', exact: true }).click()
    await colors.getByRole('button', { name: 'Add variant', exact: true }).click()
    await colors.getByLabel('Variant name', { exact: true }).fill('Light')
    await colors.getByLabel('Color value', { exact: true }).fill('#abcdef')
    await colors.getByRole('button', { name: 'Create color', exact: true }).click()
    await colors.getByRole('heading', { name: 'Ocean test / Light', exact: true }).waitFor()
    await colors.getByRole('button', { name: 'Close colors', exact: true }).click()
    await page.getByText('Colors', { exact: true }).click()
    await page
      .getByLabel('Text color source', { exact: true })
      .selectOption({ label: 'Ocean test / Light' })
    await saved()
    const insertedColor = () => inserted.evaluate((element) => getComputedStyle(element).color)
    await expect.poll(insertedColor).toBe('rgb(171, 205, 239)')
    await page.getByLabel('Element type').selectOption('paragraph')
    await page.getByLabel('Insert style class').selectOption({ label: 'project-color-test' })
    await page.getByRole('button', { name: 'Insert element', exact: true }).click()
    const paragraph = canvas.getByText('Write something worth sharing.', { exact: true })
    const paragraphColor = () => paragraph.evaluate((element) => getComputedStyle(element).color)
    await page.getByText('Colors', { exact: true }).click()
    await page
      .getByLabel('Text color source', { exact: true })
      .selectOption({ label: 'Ocean test / Light' })
    await saved()
    await expect.poll(paragraphColor).toBe('rgb(171, 205, 239)')
    await page.getByRole('button', { name: 'Project colors', exact: true }).click()
    await colors.getByRole('button', { name: 'Ocean test / Light', exact: true }).click()
    await colors.getByText('2 linked style declarations', { exact: true }).waitFor()
    await colors.getByLabel('Color value', { exact: true }).fill('#224466')
    await saved()
    await expect.poll(insertedColor).toBe('rgb(34, 68, 102)')
    await expect.poll(paragraphColor).toBe('rgb(34, 68, 102)')
    await mkdir(path.join(root, '.freeflow/editor-preview'), { recursive: true })
    await page.screenshot({ path: path.join(root, '.freeflow/editor-preview/project-colors.png') })
    await colors.getByRole('button', { name: 'Close colors', exact: true }).click()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect.poll(paragraphColor).toBe('rgb(171, 205, 239)')
    await page.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect.poll(insertedColor).toBe('rgb(34, 68, 102)')
    await page.getByText('Advanced: shared classes', { exact: true }).click()
    await page.getByRole('button', { name: 'Remove class project-color-test', exact: true }).click()
    await expect
      .poll(() =>
        page.getByRole('button', { name: 'Remove class project-color-test', exact: true }).count(),
      )
      .toBe(0)
    await page.getByText('Advanced: shared classes', { exact: true }).click()
    await page.getByText('Assign or create class', { exact: true }).click()
    await page
      .getByLabel('Assign class', { exact: true })
      .selectOption({ label: 'project-color-test' })
    await page.getByRole('button', { name: 'Assign class', exact: true }).click()
    await expect.poll(paragraphColor).toBe('rgb(34, 68, 102)')
    await page.getByRole('button', { name: 'Reload site', exact: true }).click()
    await expect.poll(insertedColor).toBe('rgb(34, 68, 102)')
    await expect.poll(paragraphColor).toBe('rgb(34, 68, 102)')
    await page.getByRole('button', { name: 'Project colors', exact: true }).click()
    await colors.getByRole('button', { name: 'Ocean test / Light', exact: true }).click()
    await colors.getByLabel('Color value', { exact: true }).fill('#ffffff')
    const beforeColorConflict = await (
      await context.request.get(`${origin}/api/sites/${siteId}/document`)
    ).json()
    const colorToken = Object.values(beforeColorConflict.document.designTokens).find(
      (token) => (token as { name: string }).name === 'color.ocean-test.light',
    ) as { id: string }
    const defaultColorMode = beforeColorConflict.document.site.modes.find(
      (mode: { default?: boolean }) => mode.default,
    ).id
    expect(
      (
        await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
          data: {
            expectedRevision: beforeColorConflict.revision,
            operations: [
              {
                type: 'designToken.setValue',
                id: colorToken.id,
                mode: defaultColorMode,
                value: { type: 'color', value: '#335577' },
              },
            ],
          },
        })
      ).status(),
    ).toBe(200)
    await colors.getByRole('alert').waitFor()
    expect(await colors.getByLabel('Color value', { exact: true }).inputValue()).toBe('#ffffff')
    page.once('dialog', (dialog) => dialog.dismiss())
    await colors.getByRole('button', { name: 'Close colors', exact: true }).click()
    expect(await colors.isVisible()).toBe(true)
    page.once('dialog', (dialog) => dialog.accept())
    await colors.getByRole('button', { name: 'Close colors', exact: true }).click()
    await page.getByRole('button', { name: 'Reload latest', exact: true }).click()
    await expect.poll(paragraphColor).toBe('rgb(51, 85, 119)')
    await expect.poll(insertedColor).toBe('rgb(51, 85, 119)')
    // A slow write must not freeze typing or overwrite keystrokes made in flight.
    await heading.click()
    let releaseWrite!: () => void
    let receivedWrite!: () => void
    const writeReceived = new Promise<void>((resolve) => {
      receivedWrite = resolve
    })
    const writeReleased = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    let writes = 0
    await page.route('**/document/apply', async (route) => {
      writes++
      if (writes === 1) {
        receivedWrite()
        await writeReleased
      }
      await route.continue()
    })
    await page.getByLabel('Text', { exact: true }).fill('First pending edit')
    await writeReceived
    await page.getByLabel('Text', { exact: true }).fill('Latest typing while saving')
    await expect.poll(() => heading.textContent()).toBe('Latest typing while saving')
    expect(await page.getByLabel('Text', { exact: true }).isEnabled()).toBe(true)
    await page.getByLabel('Size', { exact: true }).fill('47')
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe('47px')
    releaseWrite()
    await saved()
    expect(writes).toBe(2)
    expect(
      await page
        .getByLabel('Size', { exact: true })
        .evaluate((element) => element === document.activeElement),
    ).toBe(true)
    const afterTyping = await (
      await context.request.get(`${origin}/api/sites/${siteId}/document`)
    ).json()
    expect(afterTyping.document.nodes['n-home-title'].text.value).toBe('Latest typing while saving')
    await page.unroute('**/document/apply')
    await page.getByLabel('Size', { exact: true }).fill('')
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
      .not.toBe('47px')
    await saved()
    // Invalid partial values stay editable and cannot be silently discarded by navigation.
    await page.getByLabel('Size', { exact: true }).fill('not-a-size')
    await page.getByRole('alert').waitFor()
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.locator('.page-link').filter({ hasText: 'About' }).click()
    expect(await page.getByLabel('Size', { exact: true }).inputValue()).toBe('not-a-size')
    await page.getByLabel('Size', { exact: true }).fill('')
    // Failed writes keep the live draft and offer retry without a Save button.
    await page.route(
      '**/document/apply',
      (route) =>
        route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Temporary connection failure' }),
        }),
      { times: 1 },
    )
    await page.getByLabel('Text', { exact: true }).fill('Recovered autosave')
    await page.getByRole('button', { name: 'Retry changes', exact: true }).waitFor()
    expect(await heading.textContent()).toBe('Recovered autosave')
    await page.getByRole('button', { name: 'Retry changes', exact: true }).click()
    await saved()
    await page.reload()
    await expect.poll(() => heading.textContent()).toBe('Recovered autosave')
    await heading.click()
    expect(await page.getByRole('button', { name: /^Save/ }).count()).toBe(0)
    // The ribbon moves existing controls between categories without losing an autosave draft.
    await page.getByRole('button', { name: 'Layout', exact: true }).click()
    await page.locator('.ribbon-controls').getByLabel('Inside spacing', { exact: true }).fill('16')
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page
      .locator('.ribbon-controls')
      .getByLabel('Text color source', { exact: true })
      .waitFor()
    await saved()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).padding))
      .toBe('16px')
    await page.getByRole('button', { name: 'Reset formatting', exact: true }).click()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).padding))
      .toBe('0px')
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await page.locator('.ribbon-controls').getByLabel('Size', { exact: true }).waitFor()
    // Effects preview and persist through the same formatting pipeline.
    await page.getByRole('button', { name: 'Effects', exact: true }).click()
    await page.getByLabel('Opacity (%)', { exact: true }).fill('65')
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).opacity))
      .toBe('0.65')
    await saved()
    await page.getByLabel('Rotation (°)', { exact: true }).fill('12')
    await saved()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).rotate))
      .toBe('12deg')
    await page.getByLabel('Scale (%)', { exact: true }).fill('90')
    await saved()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).scale))
      .toBe('0.9')
    await page.getByLabel('Tilt X (°)', { exact: true }).fill('8')
    await saved()
    await page.getByLabel('Tilt Y (°)', { exact: true }).fill('-6')
    await saved()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).transform))
      .not.toBe('none')
    await page.getByRole('button', { name: 'Add shadow…', exact: true }).click()
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/document/apply') &&
          response.request().postData()?.includes('24px') === true,
      ),
      page.getByRole('button', { name: 'Apply shadow', exact: true }).click(),
    ])
    await saved()
    await page.getByLabel('Shadow blur', { exact: true }).fill('32')
    await saved()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).boxShadow))
      .toContain('32px')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await saved()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).boxShadow))
      .toContain('24px')
    await page.screenshot({ path: path.join(root, '.freeflow/editor-preview/editor-effects.png') })
    await page.reload()
    await heading.click()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).opacity))
      .toBe('0.65')
    await page.getByRole('button', { name: 'Reset formatting', exact: true }).click()
    await saved()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).opacity))
      .toBe('1')
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).rotate))
      .toBe('none')
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).scale))
      .toBe('none')
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).transform))
      .toBe('none')
    // Presets retain shared formatting while ordinary edits remain local.
    await page.getByLabel('Size', { exact: true }).fill('38px')
    await saved()
    await page.getByRole('button', { name: 'Create preset from selection', exact: true }).click()
    await page.getByLabel('Preset name', { exact: true }).fill('Page heading')
    await page.getByRole('button', { name: 'Create preset', exact: true }).click()
    await saved()
    await expect.poll(() => page.getByLabel('Preset', { exact: true }).inputValue()).not.toBe('')
    const presetId = await page.getByLabel('Preset', { exact: true }).inputValue()
    await page.getByLabel('Size', { exact: true }).fill('44px')
    await saved()
    await page.getByRole('button', { name: 'Reset to preset', exact: true }).click()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe('38px')
    await page.getByLabel('Size', { exact: true }).fill('46px')
    await saved()
    await page.getByRole('button', { name: 'Update preset · 1 element', exact: true }).click()
    await saved()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await saved()
    await page.getByRole('button', { name: 'Reset to preset', exact: true }).click()
    await expect
      .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
      .toBe('38px')
    await page.reload()
    await heading.click()
    await expect.poll(() => page.getByLabel('Preset', { exact: true }).inputValue()).toBe(presetId)
    await page.setViewportSize({ width: 1100, height: 800 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(await page.locator('.inspector').isVisible()).toBe(true)
    await page.screenshot({ path: path.join(root, '.freeflow/editor-preview/editor-compact.png') })
    await page.setViewportSize({ width: 1500, height: 1000 })
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
