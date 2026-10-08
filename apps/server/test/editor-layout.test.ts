import { expect, it } from 'vitest'
import { drag, editor, openFormatting, openInspectorTab } from './harness.js'

it('keeps the compact canvas in place across selection and formatting states', async () => {
  const { page, canvas } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const node = (id: string) => canvas.locator(`[data-lacuno-node="${id}"]`)
  const measure = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('.canvas-workspace')!.getBoundingClientRect()
      const inspector = document.querySelector('aside.inspector')!
      return {
        top: canvas.top,
        left: canvas.left,
        width: canvas.width,
        overflow: inspector.scrollWidth > inspector.clientWidth,
      }
    })
  const deselect = async () => {
    const box = (await page.locator('.canvas-workspace').boundingBox())!
    await page.mouse.click(box.x + 10, box.y + box.height / 2)
    await page.locator('.page-inspector').waitFor()
  }

  expect(await page.locator('.editor-ribbon').count()).toBe(0)
  for (const width of [1280, 1500, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await deselect()
    await page.getByRole('button', { name: 'Page settings', exact: true }).waitFor()
    expect(await page.locator('.connect-trigger').isVisible()).toBe(true)
    expect(await page.locator('.connect-trigger svg').count()).toBe(1)
    const baseline = await measure()
    expect(baseline.top).toBeLessThanOrEqual(140)
    expect(baseline.overflow).toBe(false)

    await node('n-home-title').click()
    for (const group of [
      'Typography',
      'Layout',
      'Size',
      'Spacing & shape',
      'Colors',
      'Effects',
      'Motion',
    ]) {
      await openFormatting(page, group)
      expect(await measure()).toEqual(baseline)
    }
    await node('n-home-hero').dispatchEvent('click')
    expect(await measure()).toEqual(baseline)
    await node('n-home-cta').click()
    await canvas.getByRole('button', { name: /^State: / }).click()
    await canvas.getByRole('menuitemradio', { name: 'Hover' }).click()
    expect(await measure()).toEqual(baseline)
    await canvas.getByRole('button', { name: /^State: / }).click()
    await canvas.getByRole('menuitemradio', { name: 'Default' }).click()

    await node('n-home-title').dblclick()
    const editable = canvas.getByLabel('Canvas text editor')
    await editable.waitFor()
    expect(await measure()).toEqual(baseline)
    await editable.evaluate((element) => {
      const range = element.ownerDocument.createRange()
      range.selectNodeContents(element.firstChild!)
      const selection = element.ownerDocument.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      element.ownerDocument.dispatchEvent(new Event('selectionchange'))
    })
    await expect.poll(() => page.locator('.text-scope').textContent()).toBe('Selected text')
    expect(await measure()).toEqual(baseline)
    await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
    await node('n-home-header').dispatchEvent('click')
    expect(await measure()).toEqual(baseline)
  }
  expect(errors).toEqual([])
}, 120_000)

it('preserves edits in focus mode and restores the inspector for inline text', async () => {
  const { page, canvas, saved } = await editor()
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  await heading.click()
  const inspector = page.locator('aside.inspector')
  await inspector.evaluate((element) => {
    element.setAttribute('data-focus-check', 'same-panel')
  })
  await openInspectorTab(page, 'Content')
  await page.getByLabel('Text', { exact: true }).fill('More room to create.')
  const before = (await page.locator('.canvas-workspace').boundingBox())!
  await page.getByRole('button', { name: 'Focus canvas', exact: true }).click()
  await expect.poll(() => page.locator('.editor-body').getAttribute('data-focus')).toBe('true')
  expect(await inspector.isVisible()).toBe(false)
  expect(await inspector.getAttribute('data-focus-check')).toBe('same-panel')
  const focused = (await page.locator('.canvas-workspace').boundingBox())!
  expect(focused.width).toBeGreaterThan(before.width)
  expect(focused.y).toBe(before.y)
  await saved()
  await expect.poll(() => heading.textContent()).toBe('More room to create.')
  await page.getByRole('button', { name: 'Focus canvas', exact: true, pressed: true }).click()
  expect(await inspector.isVisible()).toBe(true)
  expect(await inspector.getAttribute('data-focus-check')).toBe('same-panel')
  expect(await page.getByLabel('Text', { exact: true }).inputValue()).toBe('More room to create.')

  await page.getByRole('button', { name: 'Focus canvas', exact: true }).click()
  await heading.dblclick()
  await canvas.getByLabel('Canvas text editor').waitFor()
  await expect.poll(() => page.locator('.editor-body').getAttribute('data-focus')).toBe('false')
  expect(
    await page.getByRole('button', { name: 'Done editing text', exact: true }).isVisible(),
  ).toBe(true)
  await page.getByRole('button', { name: 'Cancel text edit', exact: true }).click()
}, 60_000)

it('resizes elements at an explicit canvas zoom and undoes the edit once', async () => {
  const { page, canvas, saved } = await editor()
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.click()
  await page.getByLabel('Canvas zoom', { exact: true }).selectOption('75')
  const scale = () =>
    page
      .locator('iframe[title="Site canvas"]')
      .evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)
  await expect.poll(scale).toBe(0.75)
  const width = () => cta.evaluate((element) => element.getBoundingClientRect().width)
  const before = await width()
  await drag(page, '.handle.size.right', { dx: 30 }, 2)
  await saved()
  await expect.poll(async () => (await width()) - before).toBeCloseTo(40, 0)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  await expect.poll(width).toBeCloseTo(before, 0)
  await page.getByLabel('Canvas zoom', { exact: true }).selectOption('fit')
  await expect.poll(scale).toBeLessThanOrEqual(1)
  expect(await cta.getAttribute('data-lacuno-selected')).toBe('')
}, 60_000)

it('shows typography overrides and restores one property to inheritance', async () => {
  const { page, canvas, saved } = await editor()
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  await heading.click()
  await openFormatting(page, 'Typography')
  const weight = page.getByLabel('Weight', { exact: true })
  const size = page.getByLabel('Size', { exact: true })
  const overridden = (field: typeof weight) =>
    field.evaluate((element) =>
      element.closest('[data-overridden]')?.getAttribute('data-overridden'),
    )
  const fontWeight = () => heading.evaluate((element) => getComputedStyle(element).fontWeight)

  await weight.selectOption('500')
  await saved()
  expect(await fontWeight()).toBe('500')
  expect(await overridden(weight)).toBe('false')
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect.poll(() => weight.inputValue()).toBe('')
  expect(await overridden(weight)).toBe('false')
  await weight.selectOption('700')
  await saved()
  expect(await fontWeight()).toBe('700')
  expect(await overridden(weight)).toBe('true')
  await size.fill('24px')
  await saved()
  expect(await overridden(size)).toBe('true')

  // Clearing Weight restores the desktop rule while retaining the mobile size override.
  await weight.selectOption('')
  await saved()
  await expect.poll(fontWeight).toBe('500')
  expect(await overridden(weight)).toBe('false')
  expect(await size.inputValue()).toBe('24px')
  expect(await overridden(size)).toBe('true')
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await expect.poll(() => weight.inputValue()).toBe('500')
  expect(await overridden(weight)).toBe('false')
}, 60_000)

it('opens the relevant formatting group and remembers explicit choices across selections and reloads', async () => {
  const { page, canvas } = await editor()
  const group = (name: string) => page.locator(`aside.inspector details[data-group="${name}"]`)
  const isOpen = (name: string) =>
    group(name).evaluate((element) => (element as HTMLDetailsElement).open)
  await canvas.locator('[data-lacuno-node="n-home-title"]').click()
  expect(await isOpen('Colors')).toBe(false)
  expect(await isOpen('Typography')).toBe(true)
  await group('Typography').locator(':scope > summary').click()
  await group('Colors').locator(':scope > summary').click()
  await canvas.locator('[data-lacuno-node="n-home-cta"]').click()
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect
    .poll(() => page.getByLabel('Editing breakpoint').locator('option:checked').textContent())
    .toContain('Mobile')
  expect(await isOpen('Colors')).toBe(true)
  expect(await isOpen('Size')).toBe(false)
  await group('Colors').locator(':scope > summary').click()
  await openFormatting(page, 'Size')
  // The toggle event comes after the click; wait for it to be remembered.
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('lacuno:open-sections') ?? '[]').includes('Size'),
      ),
    )
    .toBe(true)
  await page.reload()
  await canvas.locator('[data-lacuno-node="n-home-title"]').click()
  expect(await isOpen('Size')).toBe(true)
  expect(await isOpen('Colors')).toBe(false)
  expect(await isOpen('Typography')).toBe(false)
}, 60_000)
