import { expect, it } from 'vitest'
import { account, editor, openFormatting, pageSettings } from './harness.js'

it('edits a real template in the browser, persists changes, and protects drafts on conflict', async () => {
  const { context, page, canvas, origin, siteId, saved } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await canvas.locator('[data-lacuno-node="n-home-title"]').waitFor()
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  await heading.click()
  const selectionOutline = canvas.locator('.selection-dashes')
  await expect
    .poll(() => selectionOutline.evaluate((element) => getComputedStyle(element).animationName))
    .toBe('selection-march')
  await expect
    .poll(async () => Number(await selectionOutline.getAttribute('width')))
    .toBeGreaterThan(0)
  expect(await canvas.locator('.selection-label').textContent()).toBeTruthy()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect
    .poll(() => selectionOutline.evaluate((element) => getComputedStyle(element).animationName))
    .toBe('none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  // Selecting a child after styling its parent must retain the child's selection marker.
  const selectionParentId = await heading.evaluate((element) =>
    element.parentElement!.getAttribute('data-lacuno-node'),
  )
  await canvas.locator(`[data-lacuno-node="${selectionParentId}"]`).dispatchEvent('click')
  await openFormatting(page, 'Layout')
  await page.getByLabel('Inside spacing top', { exact: true }).fill('24')
  await saved()
  await heading.dispatchEvent('click')
  await expect.poll(() => heading.getAttribute('data-lacuno-selected')).toBe('')
  await expect.poll(() => canvas.locator('[data-lacuno-selected]').count()).toBe(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  await heading.dispatchEvent('click')
  await openFormatting(page, 'Typography')
  await page.getByLabel('Text', { exact: true }).fill('Made with Lacuno.')
  await expect.poll(() => heading.textContent()).toBe('Made with Lacuno.')
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
  expect(await heading.textContent()).toBe('Made with Lacuno.')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => heading.textContent()).toBe('Your website. Your rules.')
  await expect
    .poll(() => page.getByRole('button', { name: 'Undo', exact: true }).isDisabled())
    .toBe(true)
  await page.getByRole('button', { name: 'Redo', exact: true }).focus()
  await page.keyboard.press('Control+Shift+Z')
  await expect.poll(() => heading.textContent()).toBe('Made with Lacuno.')
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
    .toBe('Made with Lacuno.')
  await expect
    .poll(() => page.getByRole('button', { name: 'Undo', exact: true }).isEnabled())
    .toBe(true)
  await page.reload()
  await expect.poll(() => heading.textContent()).toBe('Made with Lacuno.')
  await expect
    .poll(() => page.getByRole('button', { name: 'Undo', exact: true }).isDisabled())
    .toBe(true)
  expect(await page.getByRole('button', { name: 'Redo', exact: true }).isDisabled()).toBe(true)
  expect(await page.locator('[data-drag-node="n-home-title"]').count()).toBe(0)
  await heading.click()
  await page.locator('[data-drag-node="n-home-title"]').click()
  expect(await page.getByLabel('Text', { exact: true }).inputValue()).toBe('Made with Lacuno.')
  await page.getByLabel('Text', { exact: true }).fill('Autosaved on navigation')
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.locator('.page-link').filter({ hasText: 'About' }).click()
  await expect.poll(() => page.locator('.page-link.active').textContent()).toContain('About')
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.locator('.page-link').filter({ hasText: 'Home' }).click()
  await expect.poll(() => heading.textContent()).toBe('Autosaved on navigation')
  await heading.click()
  await page.getByLabel('Text', { exact: true }).fill('Made with Lacuno.')
  await saved()
  await page.getByLabel('Text', { exact: true }).fill('Unsaved draft')
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
    .toBe('Made with Lacuno.')
  await expect.poll(() => heading.textContent()).toBe('Made with Lacuno.')
  expect(await page.title()).toBe('Lacuno — Editor')
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
  // The outside edit streams in and lands live; no conflict, and the designer's undo stays theirs.
  await expect.poll(() => heading.textContent()).toBe('Other session wins')
  expect(await page.getByText('changed in another session').count()).toBe(0)
  // Links select elements rather than leaving the canvas.
  await canvas.locator('a').first().click()
  await heading.waitFor()
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  const frame = page.frames().find((item) => item.url() === 'about:srcdoc')!
  expect(await frame.evaluate(() => innerWidth)).toBe(390)
  expect(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.locator('.page-link').filter({ hasText: 'Article' }).click()
  await page.getByLabel('Collection entry').selectOption({ index: 1 })
  await canvas.locator('h1').waitFor()
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.locator('.page-link').filter({ hasText: 'Home' }).click()
  await heading.waitFor()
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await heading.click()
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  expect(await page.getByRole('region', { name: 'Add panel' }).count()).toBe(1)
  expect(await page.getByRole('region', { name: 'Pages panel' }).count()).toBe(0)
  await page.getByRole('button', { name: 'Heading', exact: true }).click()
  await page.getByRole('button', { name: 'Insert element', exact: true }).click()
  await page.getByRole('region', { name: 'Layers panel' }).waitFor()
  const inserted = canvas.getByRole('heading', { name: 'Your new heading', exact: true })
  await inserted.waitFor()
  const insertedId = await inserted.getAttribute('data-lacuno-node')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => inserted.count()).toBe(0)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await inserted.waitFor()
  expect(await inserted.getAttribute('data-lacuno-node')).toBe(insertedId)
  await page.getByRole('button', { name: 'Element actions', exact: true }).click()
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
  await page.keyboard.press('Escape')
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
    .poll(() => page.getByRole('button', { name: 'Design tokens', exact: true }).isEnabled())
    .toBe(true)
  await page.getByRole('button', { name: 'Design tokens', exact: true }).click()
  const colors = page.getByRole('dialog', { name: 'Design tokens' })
  await colors.getByLabel('Color name', { exact: true }).fill('Ocean Test')
  await colors.getByLabel('Color value', { exact: true }).fill('#123456')
  await colors.getByRole('button', { name: 'Create color', exact: true }).click()
  await colors.getByRole('button', { name: 'Add variant', exact: true }).click()
  await colors.getByLabel('Variant name', { exact: true }).fill('Light')
  await colors.getByLabel('Color value', { exact: true }).fill('#abcdef')
  await colors.getByRole('button', { name: 'Create color', exact: true }).click()
  await colors.getByRole('heading', { name: 'Ocean test / Light', exact: true }).waitFor()
  await colors.getByRole('button', { name: 'Close tokens', exact: true }).click()
  await openFormatting(page, 'Colors')
  await page
    .getByLabel('Text color source', { exact: true })
    .selectOption({ label: 'Ocean test / Light' })
  await saved()
  const insertedColor = () => inserted.evaluate((element) => getComputedStyle(element).color)
  await expect.poll(insertedColor).toBe('rgb(171, 205, 239)')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Paragraph', exact: true }).click()
  await page.getByLabel('Insert style class').selectOption({ label: 'project-color-test' })
  await page.getByRole('button', { name: 'Insert element', exact: true }).click()
  const paragraph = canvas.getByText('Write something worth sharing.', { exact: true })
  await paragraph.waitFor()
  const paragraphColor = () => paragraph.evaluate((element) => getComputedStyle(element).color)
  await openFormatting(page, 'Colors')
  await page
    .getByLabel('Text color source', { exact: true })
    .selectOption({ label: 'Ocean test / Light' })
  await saved()
  await expect.poll(paragraphColor).toBe('rgb(171, 205, 239)')
  await page.getByRole('button', { name: 'Design tokens', exact: true }).click()
  await colors.getByRole('button', { name: 'Ocean test / Light', exact: true }).click()
  await colors.getByText('2 linked style declarations', { exact: true }).waitFor()
  let releaseColorWrite!: () => void
  let colorWriteSeen!: () => void
  const colorWriteReceived = new Promise<void>((resolve) => {
    colorWriteSeen = resolve
  })
  const colorWriteReleased = new Promise<void>((resolve) => {
    releaseColorWrite = resolve
  })
  await page.route(
    '**/document/apply',
    async (route) => {
      colorWriteSeen()
      await colorWriteReleased
      await route.continue()
    },
    { times: 1 },
  )
  await colors.getByLabel('Color value', { exact: true }).fill('#224466')
  await colorWriteReceived
  // Escape while that write is in flight must not offer to discard a change that is saving.
  let discardPrompt = false
  const watchDiscard = (dialog: import('playwright').Dialog) => {
    discardPrompt = true
    void dialog.dismiss()
  }
  page.on('dialog', watchDiscard)
  await page.keyboard.press('Escape')
  releaseColorWrite()
  await saved()
  page.off('dialog', watchDiscard)
  expect(discardPrompt).toBe(false)
  expect(await colors.isVisible()).toBe(true)
  await expect.poll(insertedColor).toBe('rgb(34, 68, 102)')
  await expect.poll(paragraphColor).toBe('rgb(34, 68, 102)')
  await colors.getByRole('button', { name: 'Close tokens', exact: true }).click()
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
  await page.getByRole('button', { name: 'Design tokens', exact: true }).click()
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
  await colors.getByRole('button', { name: 'Close tokens', exact: true }).click()
  expect(await colors.isVisible()).toBe(true)
  page.once('dialog', (dialog) => dialog.accept())
  await colors.getByRole('button', { name: 'Close tokens', exact: true }).click()
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
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
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
  // Opening another inspector section keeps the active autosave draft intact.
  await openFormatting(page, 'Layout')
  // Each pair is linked by default (its sides equal), so top and left fill all four → padding: 16px.
  for (const side of ['top', 'left'])
    await page
      .locator('aside.inspector')
      .getByLabel(`Inside spacing ${side}`, { exact: true })
      .fill('16')
  await openFormatting(page, 'Colors')
  await page.locator('aside.inspector').getByLabel('Text color source', { exact: true }).waitFor()
  await saved()
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element).padding))
    .toBe('16px')
  await page.getByRole('button', { name: 'Reset formatting', exact: true }).click()
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element).padding))
    .toBe('0px')
  await openFormatting(page, 'Typography')
  await page.locator('aside.inspector').getByLabel('Size', { exact: true }).waitFor()
  // Effects preview and persist through the same formatting pipeline.
  await openFormatting(page, 'Effects')
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
  await openFormatting(page, 'Motion')
  await page.getByLabel('Motion duration', { exact: true }).fill('1500')
  await saved()
  await page.getByLabel('Entrance animation', { exact: true }).selectOption('lc-slide-up')
  await saved()
  await page.getByRole('button', { name: 'Preview entrance', exact: true }).click()
  await expect
    .poll(() =>
      heading.evaluate((element) =>
        element
          .getAnimations()
          .some(
            (animation) =>
              animation instanceof CSSAnimation && animation.animationName === 'lc-slide-up',
          ),
      ),
    )
    .toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect.poll(() => heading.evaluate((element) => element.getAnimations().length)).toBe(0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: 'Reset formatting', exact: true }).click()
  await saved()
  await openFormatting(page, 'Typography')
  // Presets retain shared formatting while ordinary edits remain local.
  await page.getByLabel('Size', { exact: true }).fill('38px')
  await saved()
  await page.getByRole('button', { name: 'Preset actions', exact: true }).click()
  await page.getByRole('button', { name: 'Create preset from selection', exact: true }).click()
  await page.getByLabel('Preset name', { exact: true }).fill('Page heading')
  await page.getByRole('button', { name: 'Create preset', exact: true }).click()
  await saved()
  await expect.poll(() => page.getByLabel('Preset', { exact: true }).inputValue()).not.toBe('')
  const presetId = await page.getByLabel('Preset', { exact: true }).inputValue()
  await page.getByLabel('Size', { exact: true }).fill('44px')
  await saved()
  await page.getByRole('button', { name: 'Preset actions', exact: true }).click()
  await page.getByRole('button', { name: 'Reset to preset', exact: true }).click()
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe('38px')
  await page.getByLabel('Size', { exact: true }).fill('46px')
  await saved()
  await page.getByRole('button', { name: 'Preset actions', exact: true }).click()
  await page.getByRole('button', { name: 'Update preset · 1 element', exact: true }).click()
  await saved()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  await page.getByRole('button', { name: 'Preset actions', exact: true }).click()
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
  await page.setViewportSize({ width: 1500, height: 1000 })
  await page.mouse.move(0, 0)
  expect(errors).toEqual([])
  // Saving and undoing a lower-page edit must not return the canvas to its top. The canvas
  // morphs in place rather than reloading, so a marker on the document survives the commit.
  const lowerHeading = canvas.locator('[data-lacuno-node="n-home-feature-publish-title"]')
  await lowerHeading.click()
  const scrollBefore = await lowerHeading.evaluate(() => window.scrollY)
  expect(scrollBefore).toBeGreaterThan(300)
  const originalLowerText = await lowerHeading.textContent()
  await lowerHeading.evaluate(() => {
    document.documentElement.dataset.scrollTest = 'before'
  })
  await page.getByLabel('Text', { exact: true }).fill('Publish your site')
  await saved()
  await expect.poll(() => lowerHeading.textContent()).toBe('Publish your site')
  expect(await lowerHeading.evaluate(() => document.documentElement.dataset.scrollTest)).toBe(
    'before',
  )
  await expect.poll(() => lowerHeading.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, 0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => lowerHeading.textContent()).toBe(originalLowerText)
  await expect.poll(() => lowerHeading.evaluate(() => window.scrollY)).toBeCloseTo(scrollBefore, 0)
  // Responsive edits are isolated, including a pending edit flushed while switching sizes.
  await heading.click()
  await openFormatting(page, 'Typography')
  await page.getByLabel('Size', { exact: true }).fill('60px')
  await saved()
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect.poll(() => page.getByLabel('Size', { exact: true }).inputValue()).toBe('')
  await page.getByLabel('Size', { exact: true }).fill('24px')
  await page.getByRole('button', { name: 'Tablet', exact: true }).click()
  await expect.poll(() => page.getByLabel('Size', { exact: true }).inputValue()).toBe('')
  await page.getByLabel('Size', { exact: true }).fill('32px')
  await saved()
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe('60px')
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe('24px')
  await page.getByLabel('Size', { exact: true }).fill('')
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe('32px')
  await saved()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe('24px')
  await page.getByRole('button', { name: 'Reset formatting', exact: true }).click()
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe('32px')
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe('60px')
  // Desktop base edits are neutral; purple marks only a device-specific override.
  await openFormatting(page, 'Motion')
  await page.getByLabel('Motion delay', { exact: true }).fill('120')
  await page.getByLabel('Motion easing', { exact: true }).selectOption('linear')
  await page.getByLabel('Motion duration', { exact: true }).fill('900')
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect.poll(() => page.locator('.responsive-scope').textContent()).toContain('Mobile')
  await page.getByLabel('Motion duration', { exact: true }).fill('300')
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await expect
    .poll(() => page.getByLabel('Motion duration', { exact: true }).inputValue())
    .toBe('900')
  expect(await page.getByLabel('Motion delay', { exact: true }).inputValue()).toBe('120')
  expect(await page.getByLabel('Motion easing', { exact: true }).inputValue()).toBe('linear')
  for (const label of ['Motion duration', 'Motion delay', 'Motion easing'])
    expect(await page.getByLabel(label, { exact: true }).getAttribute('data-overridden')).toBe(
      'false',
    )
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect.poll(() => page.locator('.responsive-scope').textContent()).toContain('Mobile')
  await expect
    .poll(() => page.getByLabel('Motion duration', { exact: true }).inputValue())
    .toBe('300')
  expect(
    await page.getByLabel('Motion duration', { exact: true }).getAttribute('data-overridden'),
  ).toBe('true')
  expect(
    await page.getByLabel('Motion delay', { exact: true }).getAttribute('data-overridden'),
  ).toBe('false')
  expect(
    await page.getByLabel('Motion easing', { exact: true }).getAttribute('data-overridden'),
  ).toBe('false')
  // Wrapping preserves content and supports different arrangements at each viewport.
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  await page.locator('.layer.selected').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Element actions…' }).click()
  await page.getByText('Wrap selection in…', { exact: true }).click()
  await page.getByLabel('Wrap structure', { exact: true }).selectOption('row')
  const originalParent = await heading.evaluate((element) =>
    element.parentElement!.getAttribute('data-lacuno-node'),
  )
  await page.getByRole('button', { name: 'Wrap selection', exact: true }).click()
  await expect
    .poll(() => heading.evaluate((element) => getComputedStyle(element.parentElement!).display))
    .toBe('flex')
  await openFormatting(page, 'Layout')
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect.poll(() => page.locator('.responsive-scope').textContent()).toContain('Mobile')
  await page.getByLabel('Direction', { exact: true }).selectOption('column')
  await saved()
  await expect
    .poll(() =>
      heading.evaluate((element) => getComputedStyle(element.parentElement!).flexDirection),
    )
    .toBe('column')
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await expect
    .poll(() =>
      heading.evaluate((element) => getComputedStyle(element.parentElement!).flexDirection),
    )
    .toBe('row')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect
    .poll(() =>
      heading.evaluate((element) => element.parentElement!.getAttribute('data-lacuno-node')),
    )
    .toBe(originalParent)
  // Real native drags cross the editor/canvas boundary and remain single undoable edits.
  const drag = async (
    source: import('playwright').Locator,
    target: import('playwright').Locator,
    fraction = 0.5,
    cancel = false,
  ) => {
    await target.scrollIntoViewIfNeeded()
    await source.scrollIntoViewIfNeeded()
    const from = (await source.boundingBox())!
    const to = (await target.boundingBox())!
    // Direct mouse input avoids Playwright drag interception stalling in a script-disabled iframe.
    const session = await context.newCDPSession(page)
    const x = from.x + from.width / 2
    const y = from.y + from.height / 2
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await session.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    for (let step = 1; step <= 20; step++) {
      await session.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: x + ((to.x + to.width / 2 - x) * step) / 20,
        y: y + ((to.y + to.height * fraction - y) * step) / 20,
        button: 'left',
        buttons: 1,
      })
    }
    await expect
      .poll(
        async () =>
          (await page.locator('[data-lacuno-drop-indicator]').isVisible()) ||
          (await canvas.locator('[data-lacuno-drop-indicator]').isVisible()) ||
          (await canvas.locator('[data-lacuno-sort-gap]').count()) === 1,
      )
      .toBe(true)
    // Cancel the native drag session (the browser action behind Escape).
    if (cancel) await session.send('Input.cancelDragging')
    await session.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: to.x + to.width / 2,
      y: to.y + to.height * fraction,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
    await session.detach()
  }
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await drag(page.getByRole('button', { name: 'Stack', exact: true }), heading, 0.9)
  await expect.poll(() => page.locator('.layer.selected').textContent()).toBe('Stack')
  const stackId = await page.locator('.layer.selected').getAttribute('data-drag-node')
  const stack = canvas.locator(`[data-lacuno-node="${stackId}"]`)
  await drag(heading, stack)
  await expect
    .poll(() =>
      heading.evaluate((element) => element.parentElement!.getAttribute('data-lacuno-node')),
    )
    .toBe(stackId)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect
    .poll(() =>
      heading.evaluate((element) => element.parentElement!.getAttribute('data-lacuno-node')),
    )
    .toBe(originalParent)
  const headingLayer = page.locator('[data-drag-node="n-home-title"]')
  const stackLayer = page.locator(`[data-drag-node="${stackId}"]`)
  await drag(headingLayer, stackLayer)
  await expect
    .poll(() =>
      heading.evaluate((element) => element.parentElement!.getAttribute('data-lacuno-node')),
    )
    .toBe(stackId)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect
    .poll(() =>
      heading.evaluate((element) => element.parentElement!.getAttribute('data-lacuno-node')),
    )
    .toBe(originalParent)
  await drag(stackLayer, headingLayer, 0.05)
  await expect
    .poll(() =>
      heading.evaluate((element) =>
        element.previousElementSibling?.getAttribute('data-lacuno-node'),
      ),
    )
    .toBe(stackId)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect
    .poll(() =>
      heading.evaluate((element) => element.nextElementSibling?.getAttribute('data-lacuno-node')),
    )
    .toBe(stackId)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => stack.count()).toBe(0)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  let cancelledWrites = 0
  const watchCancelledDrag = (request: import('playwright').Request) => {
    if (request.url().endsWith('/document/apply')) cancelledWrites++
  }
  page.on('request', watchCancelledDrag)
  await drag(page.getByRole('button', { name: 'Row', exact: true }), heading, 0.9, true)
  expect(cancelledWrites).toBe(0)
  expect(await canvas.locator('[data-lacuno-drop-indicator]').isVisible()).toBe(false)
  page.off('request', watchCancelledDrag)
  // Navigator collapse, canvas reveal, naming, duplication and deletion preserve undo.
  await heading.click({ force: true })
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  await page.getByRole('button', { name: 'Collapse all', exact: true }).click()
  expect(await page.locator('[data-drag-node="n-home-title"]').count()).toBe(0)
  await heading.click({ force: true })
  await page.locator('[data-drag-node="n-home-title"]').waitFor()
  await page.locator('[data-drag-node="n-home-title"]').dblclick()
  await page.getByLabel('Element name', { exact: true }).fill('Hero title')
  await page.getByLabel('Element name', { exact: true }).press('Enter')
  await expect
    .poll(() => page.locator('[data-drag-node="n-home-title"]').textContent())
    .toBe('Hero title')
  await page.getByRole('button', { name: 'Element actions', exact: true }).click()
  await page.getByRole('button', { name: 'Duplicate element', exact: true }).click()
  await expect.poll(() => page.locator('.layer.selected').textContent()).toBe('Hero title copy')
  const copyId = await page.locator('.layer.selected').getAttribute('data-drag-node')
  const copy = canvas.locator(`[data-lacuno-node="${copyId}"]`)
  expect(await copy.textContent()).toBe(await heading.textContent())
  // Backspace in a form field on the page belongs to the field, not to the selected element.
  let deleteWrites = 0
  const watchDeleteWrites = (request: import('playwright').Request) => {
    if (request.url().endsWith('/document/apply')) deleteWrites++
  }
  page.on('request', watchDeleteWrites)
  await copy.evaluate((element) => {
    const field = element.ownerDocument.createElement('input')
    element.append(field)
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
  })
  await page.locator('.layer.selected').focus()
  await page.keyboard.press('Delete')
  await expect.poll(() => copy.count()).toBe(0)
  page.off('request', watchDeleteWrites)
  // Only the Delete on the selected layer wrote: the keystroke in the field was left alone.
  expect(deleteWrites).toBe(1)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await copy.waitFor()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => copy.count()).toBe(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  expect(await page.locator('[data-drag-node="n-home-title"]').count()).toBe(0)
  await saved()
  await heading.dispatchEvent('click')
  await expect
    .poll(() => page.locator('[data-drag-node="n-home-title"]').textContent())
    .not.toBe('Hero title')
  // Upload images, drag them into the document, and edit them through autosave.
  await page.getByRole('button', { name: 'Assets', exact: true }).click()
  const imageData = await page.evaluate(() => {
    const image = document.createElement('canvas')
    image.width = 40
    image.height = 30
    const context = image.getContext('2d')!
    context.fillStyle = '#265fd6'
    context.fillRect(0, 0, 40, 30)
    return image.toDataURL('image/png').split(',')[1]!
  })
  await page.getByLabel('Upload image, video or font', { exact: true }).setInputFiles({
    name: 'blue-card.png',
    mimeType: 'image/png',
    buffer: Buffer.from(imageData, 'base64'),
  })
  const imageTile = page.getByRole('button', { name: 'Insert blue-card.png', exact: true })
  await imageTile.waitFor()
  await drag(imageTile, heading, 0.9)
  await expect.poll(() => page.locator('.layer.selected').textContent()).toBe('Image')
  const imageId = await page.locator('.layer.selected').getAttribute('data-drag-node')
  const insertedImage = canvas.locator(`[data-lacuno-node="${imageId}"]`)
  await expect
    .poll(() => insertedImage.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBe(40)
  const uploadedSrc = await insertedImage.getAttribute('src')
  await page.getByLabel('Image alt text', { exact: true }).fill('Blue sample image')
  await expect.poll(() => insertedImage.getAttribute('alt')).toBe('Blue sample image')
  await saved()
  await page.getByLabel('Height', { exact: true }).fill('160px')
  await page.getByLabel('Image fit', { exact: true }).selectOption('contain')
  await saved()
  await expect
    .poll(() => insertedImage.evaluate((element) => getComputedStyle(element).objectFit))
    .toBe('contain')
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect.poll(() => page.locator('.responsive-scope').textContent()).toContain('Mobile')
  await page.getByLabel('Image focal point', { exact: true }).selectOption('100% 0%')
  await saved()
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await expect
    .poll(() => insertedImage.evaluate((element) => getComputedStyle(element).objectPosition))
    .toBe('50% 50%')
  await page.getByRole('button', { name: 'Change image', exact: true }).click()
  const library = page.getByRole('dialog', { name: 'Image library' })
  await library.waitFor()
  await expect
    .poll(() =>
      library
        .locator('img')
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
        ),
    )
    .toBe(true)
  await library.locator('button[aria-pressed="false"]').first().click()
  await saved()
  await expect.poll(() => insertedImage.getAttribute('src')).not.toBe(uploadedSrc)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => insertedImage.getAttribute('src')).toBe(uploadedSrc)
  await page.reload()
  await expect.poll(() => insertedImage.getAttribute('alt')).toBe('Blue sample image')
  await expect
    .poll(() => insertedImage.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBe(40)
  await insertedImage.dispatchEvent('click')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Image', exact: true }).click()
  await page.getByRole('button', { name: 'Insert element', exact: true }).click()
  await expect
    .poll(() => page.locator('.layer.selected').getAttribute('data-drag-node'))
    .not.toBe(imageId)
  await saved()
  const placeholderId = await page.locator('.layer.selected').getAttribute('data-drag-node')
  const placeholder = canvas.locator(`[data-lacuno-node="${placeholderId}"]`)
  await expect.poll(() => placeholder.evaluate((element) => element.tagName)).toBe('DIV')
  await expect.poll(() => placeholder.getAttribute('src')).toBe(null)
  await placeholder.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await page.getByRole('button', { name: 'Choose image', exact: true }).click()
  await page
    .getByRole('dialog', { name: 'Image library' })
    .getByRole('button', { name: 'Choose blue-card.png', exact: true })
    .click()
  await expect.poll(() => placeholder.evaluate((element) => element.tagName)).toBe('IMG')
  await saved()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => placeholder.evaluate((element) => element.tagName)).toBe('DIV')
  const dropFile = async (name: string, color: string) => {
    await placeholder.evaluate(
      (element, { name, color }) => {
        const image = document.createElement('canvas')
        image.width = 60
        image.height = 40
        const context = image.getContext('2d')!
        context.fillStyle = color
        context.fillRect(0, 0, 60, 40)
        const bytes = Uint8Array.from(atob(image.toDataURL('image/png').split(',')[1]!), (char) =>
          char.charCodeAt(0),
        )
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(new File([bytes], name, { type: 'image/png' }))
        element.dispatchEvent(
          new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }),
        )
        element.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }),
        )
      },
      { name, color },
    )
  }
  await dropFile('green-drop.png', '#00aa55')
  await expect.poll(() => placeholder.evaluate((element) => element.tagName)).toBe('IMG')
  await expect
    .poll(() => placeholder.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBe(60)
  await saved()
  const greenSource = await placeholder.getAttribute('src')
  await dropFile('red-drop.png', '#ff4455')
  await expect.poll(() => placeholder.getAttribute('src')).not.toBe(greenSource)
  await saved()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => placeholder.getAttribute('src')).toBe(greenSource)
  await saved()
  await page.getByRole('button', { name: 'Assets', exact: true }).click()
  // Page management, validation, confirmation, history and persisted SEO.
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: 'New page', exact: true }).click()
  let settings = page.getByRole('dialog', { name: 'New page', exact: true })
  await settings.getByLabel('Page name', { exact: true }).fill('Contact')
  await settings.getByLabel('URL path', { exact: true }).fill('/')
  await settings.getByRole('button', { name: 'Create page', exact: true }).click()
  await expect.poll(() => settings.getByRole('alert').textContent()).toContain('already uses')
  await settings.getByLabel('URL path', { exact: true }).fill('/contact')
  await settings.getByLabel('SEO title', { exact: true }).fill('Contact our team')
  await settings.getByLabel('SEO description', { exact: true }).fill('Get in touch with Lacuno.')
  await settings.getByRole('button', { name: 'Create page', exact: true }).click()
  await expect.poll(() => page.locator('.page-link.active').textContent()).toContain('Contact')
  await pageSettings(page, 'Contact')
  settings = page.getByRole('dialog', { name: 'Page settings', exact: true })
  await settings.getByLabel('Page name', { exact: true }).fill('Get in touch')
  await settings.getByLabel('URL path', { exact: true }).fill('/get-in-touch')
  await settings.getByRole('button', { name: 'Save page', exact: true }).click()
  await saved()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByRole('button', { name: 'Actions for Contact', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await pageSettings(page, 'Get in touch')
  await expect
    .poll(() => settings.getByLabel('URL path', { exact: true }).inputValue())
    .toBe('/get-in-touch')
  await settings.getByRole('button', { name: 'Duplicate page', exact: true }).click()
  await expect
    .poll(() => page.locator('.page-link.active').textContent())
    .toContain('Get in touch copy')
  await pageSettings(page, 'Get in touch copy')
  await settings.getByRole('button', { name: 'Delete page', exact: true }).click()
  await settings.getByRole('button', { name: 'Keep page', exact: true }).click()
  await expect
    .poll(() => settings.getByRole('button', { name: 'Confirm delete page', exact: true }).count())
    .toBe(0)
  await settings.getByRole('button', { name: 'Delete page', exact: true }).click()
  await settings.getByRole('button', { name: 'Confirm delete page', exact: true }).click()
  await saved()
  await expect
    .poll(() =>
      page.getByRole('button', { name: 'Actions for Get in touch copy', exact: true }).count(),
    )
    .toBe(0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await page.getByRole('button', { name: 'Actions for Get in touch copy', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await saved()
  await page.reload()
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await pageSettings(page, 'Get in touch')
  await expect
    .poll(() => settings.getByLabel('SEO title', { exact: true }).inputValue())
    .toBe('Contact our team')
  expect(await settings.getByLabel('SEO description', { exact: true }).inputValue()).toBe(
    'Get in touch with Lacuno.',
  )
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await pageSettings(page, 'Home')
  expect(
    await settings.getByRole('button', { name: 'Delete page', exact: true }).isDisabled(),
  ).toBe(true)
  await settings.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Back to sites' }).click()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('button', { name: /Updated elsewhere/ }).waitFor()
}, 60_000)
