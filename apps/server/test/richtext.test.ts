import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Locator } from 'playwright'
import { expect, it } from 'vitest'
import { editor, openFormatting, openInspectorTab, pageSettings, root } from './harness.js'

it('edits selected canvas words, preserves selection through tools, saves page links and restores history', async () => {
  const { page, canvas, saved } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  await heading.click()
  const canvasPosition = await page.locator('.canvas-workspace').boundingBox()
  // The editor's own save brings the canvas back in its answer; nothing arrives later.
  await openInspectorTab(page, 'Content')
  await page.getByLabel('Text', { exact: true }).fill('Made with Lacuno.')
  await saved()
  await heading.dblclick()
  const editable = canvas.getByLabel('Canvas text editor')
  await editable.waitFor()
  const selectText = async (element: Locator, word: string) =>
    element.evaluate((element, word) => {
      const document = element.ownerDocument
      const walker = document.createTreeWalker(element, 4)
      const start = element.textContent!.indexOf(word)
      if (start < 0) throw new Error('Missing selection text')
      const range = document.createRange()
      let offset = 0
      let started = false
      while (walker.nextNode()) {
        const node = walker.currentNode
        const length = node.textContent!.length
        if (!started && start < offset + length) {
          range.setStart(node, start - offset)
          started = true
        }
        if (started && start + word.length <= offset + length) {
          range.setEnd(node, start + word.length - offset)
          break
        }
        offset += length
      }
      document.getSelection()!.removeAllRanges()
      document.getSelection()!.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
    }, word)
  // Inline tools stay in the inspector without shifting the canvas.
  expect(await page.locator('.canvas-workspace').boundingBox()).toEqual(canvasPosition)
  expect(
    await page.locator('aside.inspector').getByLabel('Font', { exact: true }).isVisible(),
  ).toBe(true)
  await selectText(editable, 'Lacuno')
  await expect.poll(() => page.locator('.text-scope').textContent()).toBe('Selected text')
  if (
    (await page.getByRole('button', { name: 'Bold', exact: true }).getAttribute('aria-pressed')) ===
    'true'
  )
    await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await page.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect.poll(() => editable.locator('strong').textContent()).toBe('Lacuno')
  await page.getByRole('button', { name: 'Italic', exact: true }).click()
  await openInspectorTab(page, 'Style')
  await page.getByLabel('Size', { exact: true }).fill('')
  await page.getByLabel('Size', { exact: true }).pressSequentially('48px')
  expect(await page.getByLabel('Size', { exact: true }).inputValue()).toBe('48px')
  await page.getByLabel('Text color', { exact: true }).evaluate((input) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, '#cc2244')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect
    .poll(() =>
      editable
        .locator('span[style]')
        .first()
        .evaluate((el) => getComputedStyle(el).color),
    )
    .toBe('rgb(204, 34, 68)')
  await openInspectorTab(page, 'Style')
  await page.getByLabel('Font', { exact: true }).selectOption('Georgia, serif')
  await openInspectorTab(page, 'Style')
  await page.getByLabel('Alignment', { exact: true }).selectOption('center')
  expect(await heading.evaluate((el) => getComputedStyle(el).textAlign)).toBe('center')
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  await page.getByLabel('Link to page', { exact: true }).selectOption({ label: 'About' })
  await page.getByRole('button', { name: 'Apply link', exact: true }).click()
  await expect.poll(() => editable.locator('a').textContent()).toBe('Lacuno')
  expect(await editable.locator('a').getAttribute('href')).toBe('/about')
  await mkdir(path.join(root, '.lacuno/editor-preview'), { recursive: true })
  await page.screenshot({
    path: path.join(root, '.lacuno/editor-preview/editor-inline-text.png'),
  })
  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await expect.poll(() => heading.locator('strong').textContent()).toBe('Lacuno')
  expect(await heading.locator('a').getAttribute('href')).toBe('/about')
  expect(await heading.textContent()).toBe('Made with Lacuno.')
  expect(
    await heading
      .locator('span[style]')
      .first()
      .evaluate((el) => getComputedStyle(el).color),
  ).toBe('rgb(204, 34, 68)')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => heading.locator('strong').count()).toBe(0)
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect.poll(() => heading.locator('strong').textContent()).toBe('Lacuno')
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await pageSettings(page, 'About')
  await page.getByLabel('URL path', { exact: true }).fill('/our-story')
  await page.getByRole('button', { name: 'Save page', exact: true }).click()
  await expect.poll(() => heading.locator('a').getAttribute('href')).toBe('/our-story')
  await page.reload()
  await expect.poll(() => heading.locator('a').getAttribute('href')).toBe('/our-story')
  await heading.dblclick()
  await editable.waitFor()
  await editable.pressSequentially(' Extra words')
  await page.getByRole('button', { name: 'Cancel text edit', exact: true }).click()
  expect(await heading.textContent()).toBe('Made with Lacuno.')
  await page.screenshot({
    path: path.join(root, '.lacuno/editor-preview/editor-inline-cancel.png'),
  })
  await heading.dblclick()
  await editable.waitFor()
  await editable.pressSequentially(' More')
  await page.getByRole('button', { name: 'Undo text edit', exact: true }).click()
  await expect.poll(() => editable.textContent()).not.toContain(' More')
  await page.getByRole('button', { name: 'Redo text edit', exact: true }).click()
  await expect.poll(() => editable.textContent()).toContain(' More')
  // Navigation flushes a pending inline edit, and reopening the page keeps it.
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.locator('.page-link').filter({ hasText: 'About' }).click()
  await page.locator('.page-link').filter({ hasText: 'Home' }).click()
  await expect.poll(() => heading.textContent()).toContain(' More')
  // Failed writes keep the live draft and can be retried without losing marks.
  await heading.dblclick()
  await editable.waitFor()
  await editable.pressSequentially(' pending')
  const rejectSave = async (route: import('playwright').Route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Temporarily unavailable' }),
    })
  }
  await page.route('**/document/apply', rejectSave)
  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await expect
    .poll(() =>
      page.getByRole('region', { name: 'Text formatting' }).getByRole('alert').textContent(),
    )
    .toContain('draft is still here')
  expect(await editable.textContent()).toContain(' pending')
  await page.unroute('**/document/apply', rejectSave)
  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await expect.poll(() => heading.textContent()).toContain(' pending')
  await page.reload()
  await expect.poll(() => heading.textContent()).toContain(' pending')
  // Whole-text controls replace range overrides and can link the whole block without entering edit mode.
  await heading.click()
  await openFormatting(page, 'Typography')
  await openInspectorTab(page, 'Style')
  await page.getByLabel('Size', { exact: true }).fill('32px')
  await saved()
  await expect
    .poll(() =>
      heading.evaluate((el) =>
        Array.from(el.querySelectorAll('span')).every(
          (span) => getComputedStyle(span).fontSize === '32px',
        ),
      ),
    )
    .toBe(true)
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  await page.getByLabel('Link to page', { exact: true }).selectOption({ label: 'About' })
  await page.getByRole('button', { name: 'Apply link', exact: true }).click()
  await expect
    .poll(() =>
      heading
        .locator('a')
        .allTextContents()
        .then((parts) => parts.join('')),
    )
    .toBe(await heading.textContent())
  await page.getByRole('button', { name: 'Link', exact: true }).click()
  await page.getByRole('button', { name: 'Remove link', exact: true }).click()
  await expect.poll(() => heading.locator('a').count()).toBe(0)
  // With only a caret, formatting targets the whole text; Cancel restores block styles too.
  await heading.dblclick()
  await editable.waitFor()
  await editable.press('ArrowRight')
  await expect.poll(() => page.locator('.text-scope').textContent()).toBe('Whole text')
  await openInspectorTab(page, 'Style')
  await page.getByLabel('Size', { exact: true }).fill('24px')
  await openInspectorTab(page, 'Style')
  await page.getByLabel('Size', { exact: true }).fill('calc(12px + 1vw)')
  expect(await page.getByRole('button', { name: 'Done editing text' }).isDisabled()).toBe(true)
  expect(
    await page.getByRole('region', { name: 'Text formatting' }).getByRole('alert').textContent(),
  ).toContain('Use a font size')
  await openInspectorTab(page, 'Style')
  await page.getByLabel('Size', { exact: true }).fill('.5rem')
  expect(await page.getByRole('button', { name: 'Done editing text' }).isEnabled()).toBe(true)
  await expect
    .poll(() =>
      editable
        .locator('span')
        .allTextContents()
        .then((parts) => parts.join('')),
    )
    .toBe(await editable.textContent())
  await openInspectorTab(page, 'Style')
  await page.getByLabel('Alignment', { exact: true }).selectOption('right')
  await page.getByRole('button', { name: 'Cancel text edit', exact: true }).click()
  await expect.poll(() => heading.evaluate((el) => getComputedStyle(el).textAlign)).toBe('center')
  expect(errors).toEqual([])
}, 60000)
