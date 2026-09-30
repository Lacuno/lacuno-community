import type { Page } from 'playwright'
import { expect, it } from 'vitest'
import { editor, openFormatting } from './harness.js'


const text = (value: string, marks?: unknown[]) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
})
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content })
const cell = (type: string, value: string) => ({ type, content: [paragraph(text(value))] })
const row = (type: string, ...values: string[]) => ({
  type: 'tableRow',
  content: values.map((value) => cell(type, value)),
})
/** Rich text with a heading, a link and a three-column table with wordy cells. */
const body = (heading: string) => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [text(heading)] },
    paragraph(
      text('Read the '),
      text('policy', [{ type: 'link', attrs: { href: '/about' } }]),
      text('.'),
    ),
    {
      type: 'table',
      content: [
        row('tableHeader', 'Purpose', 'Legal basis', 'Retention'),
        row('tableCell', 'Signing in to the editor', 'A contract', 'Until the account is deleted'),
      ],
    },
  ],
})

const pages = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.locator('.page-link').filter({ hasText: name }).click()
}

it('styles the tags inside rich text per class, by clicking them', async () => {
  const { page, canvas, document, saved, api, siteId, publish, context } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const inspector = page.locator('aside.inspector')
  const before = await document()
  const post = before.entries['col-posts']![0]!
  // The first post's body, and a text of the About page with the same class and its own blocks.
  const applied = await api(`/api/sites/${siteId}/document/apply`, {
    expectedRevision: before.revision,
    operations: [
      {
        type: 'entry.update',
        collection: 'col-posts',
        id: post.id,
        fields: { 'f-body': body('What we collect') },
      },
      {
        type: 'node.update',
        id: 'n-about-why-p1',
        tag: 'div',
        classes: ['c-prose'],
        text: body('Who it is for'),
      },
    ],
  })
  expect(applied.status).toBe(200)

  await pages(page, 'Article')
  const article = canvas.locator('[data-lacuno-node="n-article-body"]')
  const heading = article.locator('h2')
  await heading.scrollIntoViewIfNeeded()
  await heading.click()
  await expect
    .poll(() => inspector.locator('.selection-heading strong').textContent())
    .toBe('H2 in prose')
  await expect.poll(() => heading.getAttribute('data-lacuno-selected')).toBe('')
  await openFormatting(page, 'Typography')
  await inspector.getByLabel('Size', { exact: true }).fill('40')
  await saved()
  const size = (element: typeof heading) =>
    element.evaluate((node) => getComputedStyle(node).fontSize)
  await expect.poll(() => size(heading)).toBe('40px')
  expect((await document()).styles['c-prose|h2|base|none|font-size']?.value).toEqual({
    type: 'unit',
    value: 40,
    unit: 'px',
  })

  // A link's hover, through the state chip on the canvas label.
  await article.locator('a').click()
  await expect
    .poll(() => inspector.locator('.selection-heading strong').textContent())
    .toBe('Links in prose')
  await canvas.getByRole('button', { name: /^State: / }).click()
  await canvas.getByRole('menuitemradio', { name: 'Hover' }).click()
  await expect.poll(() => article.locator('a').getAttribute('data-lc-state')).toBe('hover')
  await openFormatting(page, 'Colors')
  await inspector.getByLabel('Text color', { exact: true }).fill('#ff0000')
  await saved()
  await expect
    .poll(() => article.locator('a').evaluate((node) => getComputedStyle(node).color))
    .toBe('rgb(255, 0, 0)')
  await canvas.getByRole('button', { name: /^State: / }).click()
  await canvas.getByRole('menuitemradio', { name: 'Default' }).click()

  // Cells, then header cells from the list of other tags, lose the 8em minimum on a phone.
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await article.locator('td').first().click()
  await expect
    .poll(() => inspector.locator('.selection-heading strong').textContent())
    .toBe('Cells in prose')
  await openFormatting(page, 'Size')
  await inspector.getByLabel('Minimum width', { exact: true }).fill('0')
  await saved()
  await inspector.getByLabel('Style other tags').selectOption({ label: 'Header cells' })
  await expect
    .poll(() => inspector.locator('.selection-heading strong').textContent())
    .toBe('Header cells in prose')
  await inspector.getByLabel('Minimum width', { exact: true }).fill('0')
  await saved()
  const styles = (await document()).styles
  expect(styles['c-prose|td|mobile-p|none|min-width']).toBeDefined()
  expect(styles['c-prose|th|mobile-p|none|min-width']).toBeDefined()

  // A tag the content does not hold yet.
  await inspector.getByLabel('Style other tags').selectOption({ label: 'H3' })
  await expect
    .poll(() => inspector.locator('.selection-heading strong').textContent())
    .toBe('H3 in prose')
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  // The breadcrumb goes back to the block itself, which offers the tags too.
  await inspector.locator('.inspector-parent').click()
  await expect.poll(() => inspector.getByLabel('Style other tags').count()).toBe(1)
  await expect.poll(() => article.getAttribute('data-lacuno-selected')).toBe('')

  // The About page's text carries the same class, so its heading follows; its words still edit.
  await pages(page, 'About')
  const about = canvas.locator('[data-lacuno-node="n-about-why-p1"]')
  await about.scrollIntoViewIfNeeded()
  await expect.poll(() => size(about.locator('h2'))).toBe('40px')
  await about.locator('h2').click()
  await expect
    .poll(() => inspector.locator('.selection-heading strong').textContent())
    .toBe('H2 in prose')
  await about.locator('h2').dblclick()
  const editable = canvas.getByLabel('Canvas text editor')
  await editable.waitFor()
  await editable.locator('h2').click()
  await page.keyboard.press('End')
  await page.keyboard.type(' today')
  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await saved()
  await expect.poll(() => about.locator('h2').textContent()).toBe('Who it is for today')

  // A block without a class gets a style named after its page with the first change.
  const bare = await document()
  await api(`/api/sites/${siteId}/document/apply`, {
    expectedRevision: bare.revision,
    operations: [{ type: 'node.update', id: 'n-about-why-p1', classes: [] }],
  })
  await about.locator('h2').click()
  await expect
    .poll(() => inspector.locator('.selection-heading strong').textContent())
    .toBe('H2 in About rich text')
  await openFormatting(page, 'Typography')
  await inspector.getByLabel('Weight', { exact: true }).selectOption('800')
  await saved()
  const created = Object.values((await document()).classes).find(
    (cls) => cls.name === 'About rich text',
  )!
  expect(created.preset).toBe(true)
  expect((await document()).nodes['n-about-why-p1']!.classes).toEqual([created.id])

  // Published, the post's table fits a phone without scrolling sideways.
  const url = await publish()
  const published = await context.newPage()
  await published.setViewportSize({ width: 375, height: 800 })
  await published.goto(`${url}/blog/${post.fields['f-slug']}`)
  const region = published.getByRole('region', { name: 'Table' })
  await region.scrollIntoViewIfNeeded()
  expect(await region.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  expect(
    await published.evaluate(() => window.document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true)
  expect(errors).toEqual([])
}, 180_000)
