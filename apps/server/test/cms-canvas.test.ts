import type { CollectionListNode } from '@lacuno/schema'
import { expect, it } from 'vitest'
import { editor, openInspectorTab, pageSettings } from './harness.js'

it('lists, binds and publishes collection content on the canvas', async () => {
  const { page, canvas, document: site, saved, api, siteId, server, publish } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const inspector = page.locator('aside.inspector')
  const list = async () =>
    Object.values((await site()).nodes).find(
      (node): node is CollectionListNode =>
        node.type === 'collection-list' && node.meta?.label === 'Posts list',
    )!

  // A cover image field, filled for every post, for the image binding below.
  const logo = Object.values((await site()).assets).find((asset) => asset.kind === 'svg')!
  const before = await site()
  const added = await api(`/api/sites/${siteId}/document/apply`, {
    expectedRevision: before.revision,
    operations: [
      {
        type: 'field.add',
        collection: 'col-posts',
        field: { id: 'f-cover', name: 'cover', label: 'Cover', type: 'image' },
      },
      ...before.entries['col-posts']!.map((entry) => ({
        type: 'entry.update',
        collection: 'col-posts',
        id: entry.id,
        fields: { 'f-cover': logo.id },
      })),
    ],
  })
  expect(added.status).toBe(200)

  // Insert a list of posts: a card per entry, designed once.
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Collection list' }).click()
  await page.getByRole('button', { name: 'Insert element' }).click()
  await saved()
  const inList = canvas.locator(`[data-lacuno-node="${(await list()).id}"]`)
  const cards = inList.locator(`[data-lacuno-node="${(await list()).children[0]}"]`)
  await expect.poll(() => cards.count()).toBe(3)
  await expect.poll(() => inList.locator('img').first().getAttribute('src')).toContain(logo.hash)
  expect(await inList.locator('a').first().getAttribute('href')).toMatch(/^\/blog\//)

  // Filter, sort, limit and split into pages.
  await openInspectorTab(page, 'Content')
  await inspector.getByLabel('Sort by').selectOption({ label: 'Title' })
  await saved()
  await inspector.getByLabel('Sort order').selectOption('desc')
  await saved()
  await expect
    .poll(() => inList.locator('h3').allTextContents())
    .toEqual([
      'Your website should belong to you',
      'Two ways to make it yours',
      'From document to website',
    ])
  await inspector.getByRole('button', { name: 'Add filter' }).click()
  await saved()
  await expect.poll(() => cards.count()).toBe(1)
  await inspector.getByLabel('Filter operator').selectOption('ne')
  await saved()
  await expect.poll(() => cards.count()).toBe(2)
  await inspector.getByRole('button', { name: 'Remove filter' }).click()
  await saved()
  await inspector.getByLabel('Limit').fill('2')
  await inspector.getByLabel('Limit').press('Enter')
  await saved()
  await expect.poll(() => cards.count()).toBe(2)
  await inspector.getByLabel('Split into pages').click()
  await saved()
  expect((await list()).query).toEqual({
    sort: [{ field: 'f-title', direction: 'desc' }],
    limit: 2,
    paginate: true,
  })

  // Bind: the summary shows another field, a date gets a format, unbinding keeps the words.
  const summary = inList.locator('p').first()
  await summary.click()
  await expect.poll(() => page.locator('.field-chip').textContent()).toBe('Summary')
  await expect.poll(() => canvas.locator('.selection-label .field').textContent()).toBe('Summary')
  await openInspectorTab(page, 'Content')
  await inspector.getByLabel('Content from').selectOption({ label: 'Posts · Slug' })
  await saved()
  await expect.poll(() => summary.textContent()).toBe('your-website-your-rules')
  await openInspectorTab(page, 'Content')
  await inspector.getByLabel('Content from').selectOption({ label: 'Written text' })
  await saved()
  const summaryId = (await summary.getAttribute('data-lacuno-node'))!
  expect((await site()).nodes[summaryId]).toMatchObject({
    type: 'text',
    text: { type: 'doc' },
  })
  expect(await page.locator('.field-chip').count()).toBe(0)

  // Image and link: the cover and alt text come from the entry, the link from its slug or URL.
  await inList.locator('img').first().click()
  await expect.poll(() => inspector.getByLabel('Image from').inputValue()).toBe('f-cover')
  await openInspectorTab(page, 'Content')
  await inspector.getByLabel('Alt text from').selectOption({ label: 'Written text' })
  await saved()
  expect(await inList.locator('img').first().getAttribute('alt')).toBe('')
  await openInspectorTab(page, 'Content')
  await inspector.getByLabel('Alt text from').selectOption({ label: 'Posts · Title' })
  await saved()
  expect(await inList.locator('img').first().getAttribute('alt')).toBe(
    'Your website should belong to you',
  )
  await inList.locator('a').first().click()
  await expect
    .poll(() => page.locator('.link-target-row > strong').textContent())
    .toBe('Field: Slug')
  await openInspectorTab(page, 'Content')
  await inspector.getByLabel('Link from').selectOption({ label: 'Posts · URL' })
  await saved()
  expect(await inList.locator('a').first().getAttribute('href')).toBe(
    '/blog/your-website-your-rules',
  )

  // The template page previews one entry at a time; SEO reads the entry's fields.
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: /^Article/ }).click()
  const heading = canvas.locator('h1')
  await expect.poll(() => heading.textContent()).toBe('Your website should belong to you')
  await page.getByLabel('Collection entry').selectOption({ label: 'Two ways to make it yours' })
  await expect.poll(() => heading.textContent()).toBe('Two ways to make it yours')
  await page.getByRole('button', { name: 'Edit entry' }).click()
  const cms = page.getByRole('dialog', { name: 'CMS' })
  await cms.getByRole('heading', { name: 'Two ways to make it yours' }).waitFor()
  await cms.getByLabel('Title', { exact: true }).fill('Two ways to own it')
  await cms.getByRole('button', { name: 'Save', exact: true }).click()
  await saved()
  await page.keyboard.press('Escape')
  await expect.poll(() => heading.textContent()).toBe('Two ways to own it')
  await pageSettings(page, 'Article')
  await page.getByLabel('SEO title from').selectOption({ label: 'Posts · Title' })
  await page.getByRole('button', { name: 'Save page' }).click()
  await saved()
  expect((await site()).pages['p-article']!.seo?.fields).toEqual({ title: 'f-title' })

  // A page for each entry of a new collection, from the Pages panel; empty until an entry exists.
  const created = await api(`/api/sites/${siteId}/document/apply`, {
    expectedRevision: (await site()).revision,
    operations: [
      {
        type: 'collection.create',
        id: 'col-team',
        name: 'Team',
        slug: 'team',
        fields: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'slug', label: 'Slug', type: 'slug', required: true },
        ],
        slugField: 'slug',
      },
    ],
  })
  expect(created.status).toBe(200)
  await page.getByRole('button', { name: 'New page' }).click()
  await page.getByLabel('Page for').selectOption({ label: 'Each entry of Team' })
  expect(await page.getByLabel('URL path').inputValue()).toBe('/team/[slug]')
  await page.getByRole('button', { name: 'Create page' }).click()
  // Opening the new page ends the save's session, so the status reads "Saved".
  await expect
    .poll(async () => Object.values((await site()).pages).some((p) => p.collection === 'col-team'))
    .toBe(true)
  await page.locator('.entry-switcher', { hasText: 'No team yet' }).waitFor()
  await canvas.locator('h1').waitFor({ state: 'attached' })
  await page.locator('.entry-switcher').getByRole('button', { name: 'Add entry' }).click()
  await cms.getByLabel('Name', { exact: true }).fill('Ada')
  await cms.getByRole('button', { name: 'Create entry' }).click()
  await saved()
  await page.keyboard.press('Escape')
  await expect.poll(() => canvas.locator('h1').textContent()).toBe('Ada')

  // Publishing builds every entry's page with its title, and the list's second page.
  const live = await publish()
  const html = async (path: string) => (await server.published!.request(live + path)).text()
  expect(await html('/blog/hosted-or-self-hosted')).toContain('<title>Two ways to own it</title>')
  expect(await html('/team/ada')).toContain('>Ada</h1>')
  const second = await html('/page/2')
  expect(second).toContain('From document to website')
  expect(second).toContain('Page 2 of 2')
  expect(errors).toEqual([])
}, 240_000)
