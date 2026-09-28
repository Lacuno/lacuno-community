import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { FrameLocator, Locator, Page } from 'playwright'
import { expect, it } from 'vitest'
import { editor, root } from './harness.js'

const shots = path.join(root, '.lacuno/editor-preview')

/** Pastes clipboard data into an editable, as a browser paste would. */
const paste = (editable: Locator, data: Record<string, string>) =>
  editable.evaluate((element, data) => {
    const transfer = new (element.ownerDocument.defaultView as typeof window).DataTransfer()
    for (const [type, value] of Object.entries(data)) transfer.setData(type, value)
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    )
  }, data)

/** The text of each row's cells, header cells in capitals. */
const cells = (scope: Locator | FrameLocator) =>
  scope
    .locator('table')
    .first()
    .evaluate((table) =>
      Array.from(table.querySelectorAll('tr'), (row) =>
        Array.from(row.children, (cell) =>
          cell.tagName === 'TH' ? cell.textContent!.toUpperCase() : cell.textContent!,
        ),
      ),
    )

const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

it('inserts and edits a table in a canvas text and publishes it', async () => {
  const { page, canvas, saved, document, publish, context } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.locator('.page-link').filter({ hasText: 'About' }).click()
  const text = canvas.locator('[data-lacuno-node="n-about-why-p1"]')
  await text.scrollIntoViewIfNeeded()
  await text.click()
  await text.dblclick()
  const editable = canvas.getByLabel('Canvas text editor')
  await editable.waitFor()
  await editable.press('End')
  await tool(page, 'Insert table').click()
  await expect
    .poll(() => cells(editable))
    .toEqual([
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ])
  // Tab moves through the cells, Shift+Tab back; Tab past the last cell adds a row.
  for (const word of ['What', 'Why', 'Basis', 'Email', 'Sign-in']) {
    await page.keyboard.type(word)
    await page.keyboard.press('Tab')
  }
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.type('Sign in')
  for (let step = 0; step < 5; step++) await page.keyboard.press('Tab')
  await page.keyboard.type('Last')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.type('End')
  expect(await cells(editable)).toEqual([
    ['WHAT', 'WHY', 'BASIS'],
    ['Email', 'Sign in', ''],
    ['', '', ''],
    ['Last', '', 'End'],
  ])
  // Enter at the end of the last cell adds a row too.
  await page.keyboard.press('Enter')
  await page.keyboard.type('Added')
  expect((await cells(editable)).at(-1)).toEqual(['Added', '', ''])
  // Rows and columns around the caret, from the table's own tools.
  await tool(page, 'Delete row').click()
  await tool(page, 'Delete row').click()
  expect(await cells(editable)).toEqual([
    ['WHAT', 'WHY', 'BASIS'],
    ['Email', 'Sign in', ''],
    ['', '', ''],
  ])
  const cell = (row: number, column: number) =>
    editable.locator('tr').nth(row).locator('th, td').nth(column)
  await cell(1, 1).click()
  await tool(page, 'Add row above').click()
  await tool(page, 'Add column right').click()
  await tool(page, 'Add column left').click()
  expect(await cells(editable)).toEqual([
    ['WHAT', '', 'WHY', '', 'BASIS'],
    ['', '', '', '', ''],
    ['Email', '', 'Sign in', '', ''],
    ['', '', '', '', ''],
  ])
  await cell(1, 0).click()
  await tool(page, 'Delete row').click()
  await cell(1, 1).click()
  await tool(page, 'Delete column').click()
  await cell(1, 2).click()
  await tool(page, 'Delete column').click()
  expect(await cells(editable)).toEqual([
    ['WHAT', 'WHY', 'BASIS'],
    ['Email', 'Sign in', ''],
    ['', '', ''],
  ])
  // The header row switches off and on again.
  await tool(page, 'Header row').click()
  expect((await cells(editable))[0]).toEqual(['What', 'Why', 'Basis'])
  expect(await tool(page, 'Header row').getAttribute('aria-pressed')).toBe('false')
  await tool(page, 'Header row').click()
  expect((await cells(editable))[0]).toEqual(['WHAT', 'WHY', 'BASIS'])
  await mkdir(shots, { recursive: true })
  await page.screenshot({ path: path.join(shots, 'tables-canvas-editor.png') })
  // A table pasted from a web page arrives as a table, and Delete removes it again.
  await editable
    .locator('p')
    .first()
    .evaluate((paragraph) => {
      paragraph.ownerDocument.getSelection()!.collapse(paragraph, paragraph.childNodes.length)
    })
  await tool(page, 'Insert table').waitFor()
  await paste(editable, {
    'text/html':
      '<table><thead><tr><th>Pasted</th><th>Head</th></tr></thead><tbody><tr><td>one <b>bold</b></td><td>two</td></tr></tbody></table>',
  })
  await expect.poll(() => editable.locator('table').count()).toBe(2)
  expect(await cells(editable)).toEqual([
    ['PASTED', 'HEAD'],
    ['one bold', 'two'],
  ])
  await editable.locator('td').filter({ hasText: 'two' }).click()
  await tool(page, 'Delete table').click()
  await expect.poll(() => editable.locator('table').count()).toBe(1)
  // Done saves the table; the paragraph becomes a div, since a p cannot hold a table.
  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await saved()
  const node = (await document()).nodes['n-about-why-p1']!
  expect(node.type === 'text' && node.tag).toBe('div')
  expect(JSON.stringify(node.type === 'text' && node.text)).toContain('"type":"tableHeader"')
  await expect.poll(() => text.locator('thead th[scope="col"]').count()).toBe(3)
  expect(await text.locator('.lc-table[role="region"] tbody tr').count()).toBe(2)
  await text.screenshot({ path: path.join(shots, 'tables-canvas-edit.png') })
  // Published, the table scrolls sideways within its region on a phone.
  const url = await publish()
  const published = await context.newPage()
  await published.setViewportSize({ width: 375, height: 800 })
  await published.goto(`${url}/about`)
  const region = published.getByRole('region', { name: 'Table' })
  expect(await cells(region)).toEqual([
    ['WHAT', 'WHY', 'BASIS'],
    ['Email', 'Sign in', ''],
    ['', '', ''],
  ])
  expect(await region.evaluate((element) => getComputedStyle(element).overflowX)).toBe('auto')
  expect(errors).toEqual([])
}, 90000)

it('edits a table in a CMS rich-text field, from Markdown and HTML pastes', async () => {
  const { page, saved, document, publish, context } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('button', { name: 'CMS', exact: true }).click()
  await page.getByRole('button', { name: /^Posts/ }).click()
  const dialog = page.getByRole('dialog', { name: 'CMS' })
  await dialog.getByRole('button', { name: 'From document to website' }).click()
  const body = dialog.getByRole('textbox', { name: 'Body' })
  await body.click()
  await page.keyboard.press('ControlOrMeta+End')
  await dialog.getByRole('button', { name: 'Insert table' }).click()
  await expect
    .poll(() => cells(body))
    .toEqual([
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ])
  // Inside a table, its tools replace the block tools and Insert table: tables do not nest.
  expect(await dialog.getByRole('button', { name: 'Insert table' }).count()).toBe(0)
  expect(await dialog.getByRole('button', { name: 'Bulleted list' }).count()).toBe(0)
  for (const word of ['What', 'Why', 'Basis']) {
    await page.keyboard.type(word)
    await page.keyboard.press('Tab')
  }
  await page.keyboard.type('Email')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.type('Legal basis')
  await tool(page, 'Add row below').click()
  await tool(page, 'Add column right').click()
  expect(await cells(body)).toEqual([
    ['WHAT', 'WHY', 'LEGAL BASIS', ''],
    ['', '', '', ''],
    ['Email', '', '', ''],
    ['', '', '', ''],
  ])
  await tool(page, 'Delete column').click()
  await body.locator('tr').nth(1).locator('td').first().click()
  await tool(page, 'Delete row').click()
  await tool(page, 'Header row').click()
  expect(await cells(body)).toEqual([
    ['What', 'Why', ''],
    ['Email', '', ''],
    ['', '', ''],
  ])
  await tool(page, 'Header row').click()
  await tool(page, 'Delete table').click()
  await expect.poll(() => body.locator('table').count()).toBe(0)
  // A table copied from a web page, then Markdown text, each paste as a table.
  await paste(body, {
    'text/html':
      '<meta charset="utf-8"><table><tr><th>Plan</th><th>Price</th></tr><tr><td>Free</td><td><a href="https://example.com/free">0 €</a></td></tr></table>',
    'text/plain': 'Plan Price Free 0 €',
  })
  await expect
    .poll(() => cells(body))
    .toEqual([
      ['PLAN', 'PRICE'],
      ['Free', '0 €'],
    ])
  expect(await body.locator('td a').getAttribute('href')).toBe('https://example.com/free')
  await body.locator('td').first().click()
  await tool(page, 'Delete table').click()
  await expect.poll(() => body.locator('table').count()).toBe(0)
  await paste(body, {
    'text/plain': [
      '| What | Why | Legal basis (GDPR) |',
      '| --- | --- | --- |',
      '| Name, email | To create and run your account | Art. 6(1)(b), contract |',
      '| Nightly backups | To recover from failures | Art. 6(1)(f) |',
    ].join('\n'),
  })
  await expect
    .poll(() => cells(body))
    .toEqual([
      ['WHAT', 'WHY', 'LEGAL BASIS (GDPR)'],
      ['Name, email', 'To create and run your account', 'Art. 6(1)(b), contract'],
      ['Nightly backups', 'To recover from failures', 'Art. 6(1)(f)'],
    ])
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await saved()
  const post = (await document()).entries['col-posts']!.find(
    (entry) => entry.id === 'e-document-workflow',
  )!
  expect(JSON.stringify(post.fields['f-body'])).toContain('"type":"tableHeader"')
  const url = await publish()
  const published = await context.newPage()
  await published.goto(`${url}/blog/from-document-to-website`)
  const region = published.getByRole('region', { name: 'Table' })
  expect(await region.locator('thead th[scope="col"]').count()).toBe(3)
  expect(await region.locator('tbody tr').count()).toBe(2)
  expect(errors).toEqual([])
}, 90000)
