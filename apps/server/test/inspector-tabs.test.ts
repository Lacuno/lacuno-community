import { expect, it } from 'vitest'
import { editor, openFormatting, openInspectorTab } from './harness.js'

it('keeps content and class drafts across focused tabs and saves them without changing tabs', async () => {
  const { page, canvas, saved, document } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const paragraph = canvas.locator('[data-lacuno-node="n-home-note-copy"]')
  await paragraph.click()
  const inspector = page.locator('aside.inspector')
  const tab = (name: string) => inspector.getByRole('tab', { name, exact: true })
  expect(await tab('Style').getAttribute('aria-selected')).toBe('true')
  expect(await inspector.getByLabel('Size', { exact: true }).isVisible()).toBe(true)
  expect(await inspector.getByLabel('Text', { exact: true }).isVisible()).toBe(false)

  // Arrow keys move focus and selection. Hidden fields retain their draft until autosave lands.
  await tab('Style').press('ArrowRight')
  expect(
    await tab('Content').evaluate((element) => element === element.ownerDocument.activeElement),
  ).toBe(true)
  await inspector.getByLabel('Text', { exact: true }).fill('A calmer place to create.')
  await tab('Content').press('ArrowLeft')
  await inspector.getByLabel('Size', { exact: true }).fill('28px')
  await saved()
  await expect.poll(() => paragraph.textContent()).toBe('A calmer place to create.')
  await expect
    .poll(() => paragraph.evaluate((element) => getComputedStyle(element).fontSize))
    .toBe('28px')
  expect(await tab('Style').getAttribute('aria-selected')).toBe('true')
  await openInspectorTab(page, 'Content')
  expect(await inspector.getByLabel('Text', { exact: true }).inputValue()).toBe(
    'A calmer place to create.',
  )

  await tab('Content').press('End')
  await inspector.getByText('Assign or create class', { exact: true }).click()
  await inspector.getByLabel('New class name', { exact: true }).fill('calm-copy')
  await openInspectorTab(page, 'Style')
  expect(await inspector.getByLabel('Size', { exact: true }).isDisabled()).toBe(true)
  await openInspectorTab(page, 'Advanced')
  expect(await inspector.getByLabel('New class name', { exact: true }).inputValue()).toBe(
    'calm-copy',
  )
  await inspector.getByRole('button', { name: 'Create and assign' }).click()
  await saved()
  expect(Object.values((await document()).classes).some((item) => item.name === 'calm-copy')).toBe(
    true,
  )
  expect(await tab('Advanced').getAttribute('aria-selected')).toBe('true')

  // Even though the class save remounts the inspector, tabs and explicit section choices survive.
  await openFormatting(page, 'Typography')
  await inspector.locator('[data-group="Typography"] > summary').click()
  await inspector.getByLabel('Editing breakpoint').selectOption('tablet')
  await expect.poll(() => inspector.getByLabel('Editing breakpoint').inputValue()).toBe('tablet')
  expect(
    await inspector
      .locator('[data-group="Typography"]')
      .evaluate((element) => (element as HTMLDetailsElement).open),
  ).toBe(false)
  expect(await tab('Style').getAttribute('aria-selected')).toBe('true')
  expect(errors).toEqual([])
}, 60000)

it('flushes drafts before changing scope and keeps failed saves reachable from another tab', async () => {
  const { page, canvas, saved, document } = await editor()
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  await heading.click()
  const inspector = page.locator('aside.inspector')
  await openInspectorTab(page, 'Content')
  await inspector.getByLabel('Text', { exact: true }).fill('Saved before changing scope.')
  await inspector.getByLabel('Editing breakpoint').selectOption('tablet')
  await expect.poll(() => inspector.getByLabel('Editing breakpoint').inputValue()).toBe('tablet')
  expect(
    await inspector
      .getByRole('tab', { name: 'Content', exact: true })
      .getAttribute('aria-selected'),
  ).toBe('true')
  await openFormatting(page, 'Typography')
  await inspector.getByLabel('Size', { exact: true }).fill('36px')
  await inspector.getByLabel('Editing state').selectOption('hover')
  await expect.poll(() => inspector.getByLabel('Editing state').inputValue()).toBe('hover')
  const doc = await document()
  const classes = doc.nodes['n-home-title']!.classes
  expect(
    Object.values(doc.styles).some(
      (style) =>
        classes.includes(style.class) &&
        style.property === 'font-size' &&
        style.breakpoint === 'tablet' &&
        style.state === 'none' &&
        style.value.type === 'raw' &&
        style.value.value === '36px',
    ),
  ).toBe(true)

  await page.route(
    '**/document/apply',
    (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Temporary save failure' }),
      }),
    { times: 1 },
  )
  await openInspectorTab(page, 'Content')
  await inspector.getByLabel('Text', { exact: true }).fill('Recovered across tabs.')
  await openInspectorTab(page, 'Style')
  await inspector.getByRole('button', { name: 'Retry changes' }).waitFor()
  await inspector.getByRole('button', { name: 'Retry changes' }).click()
  await saved()
  await expect.poll(() => heading.textContent()).toBe('Recovered across tabs.')
}, 60000)
