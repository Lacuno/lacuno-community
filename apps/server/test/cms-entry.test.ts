import path from 'node:path'
import { expect, it } from 'vitest'
import { editor, pageSettings, root } from './harness.js'

const shot = (name: string) => path.join(root, `.lacuno/editor-preview/entrybind-${name}.png`)

it('shows a chosen CMS entry on a normal page and keeps it from being deleted', async () => {
  const { page, canvas, document: site, saved, api, siteId, server, publish } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const inspector = page.locator('aside.inspector')

  // A Legal collection with the privacy text, and a /privacy page still written by hand.
  const text = (value: string) => ({ type: 'text', text: value })
  const created = await api(`/api/sites/${siteId}/document/apply`, {
    expectedRevision: (await site()).revision,
    operations: [
      {
        type: 'collection.create',
        id: 'col-legal',
        name: 'Legal',
        slug: 'legal',
        fields: [
          { id: 'f-legal-title', name: 'title', label: 'Title', type: 'text', required: true },
          { id: 'f-legal-slug', name: 'slug', label: 'Slug', type: 'slug', required: true },
          { id: 'f-legal-body', name: 'body', label: 'Body', type: 'richtext' },
        ],
        slugField: 'slug',
      },
      ...[
        ['e-imprint', 'Imprint', 'imprint'],
        ['e-privacy', 'Privacy', 'privacy'],
      ].map(([id, title, slug]) => ({
        type: 'entry.create',
        collection: 'col-legal',
        id,
        fields: {
          'f-legal-title': title,
          'f-legal-slug': slug,
          'f-legal-body': {
            type: 'doc',
            content: [
              { type: 'heading', attrs: { level: 2 }, content: [text('1. Who we are')] },
              { type: 'paragraph', content: [text(`${title} text.`)] },
              {
                type: 'bulletList',
                content: ['Name', 'Email'].map((item) => ({
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [text(item)] }],
                })),
              },
            ],
          },
        },
      })),
      {
        type: 'page.create',
        id: 'p-privacy',
        name: 'Privacy',
        path: '/privacy',
        root: {
          id: 'n-privacy',
          type: 'element',
          tag: 'main',
          children: [
            {
              id: 'n-privacy-title',
              type: 'text',
              tag: 'h1',
              text: { type: 'static', value: 'Privacy' },
            },
            {
              id: 'n-privacy-body',
              type: 'text',
              tag: 'p',
              text: { type: 'static', value: 'Draft' },
            },
          ],
        },
      },
    ],
  })
  expect(created.status).toBe(200)
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: /^Privacy/ }).click()
  const body = canvas.locator('[data-lacuno-node="n-privacy-body"]')
  await body.click()

  // Pick collection, entry and field: the body shows the entry's rich text as blocks.
  await inspector.getByLabel('Content from').selectOption({ label: 'From the CMS…' })
  const picker = inspector.getByRole('group', { name: 'Choose from the CMS' })
  await picker.getByLabel('Collection').selectOption({ label: 'Legal' })
  await picker.getByRole('combobox', { name: 'Entry' }).fill('priv')
  await picker.getByRole('option', { name: 'Privacy' }).click()
  await page.screenshot({ path: shot('picker') })
  await picker.getByLabel('Field').selectOption({ label: 'Body' })
  await saved()
  expect((await site()).nodes['n-privacy-body']).toMatchObject({
    tag: 'div',
    text: { type: 'field', entry: 'e-privacy', field: 'f-legal-body' },
  })
  await expect.poll(() => page.locator('.field-chip').textContent()).toBe('Legal › Privacy › Body')
  await expect.poll(() => body.locator('h2').textContent()).toBe('1. Who we are')
  expect(await body.locator('li').allTextContents()).toEqual(['Name', 'Email'])
  await page.screenshot({ path: shot('bound') })

  // The heading's picker starts on the entry the page already reads.
  await canvas.locator('[data-lacuno-node="n-privacy-title"]').click()
  await inspector.getByLabel('Content from').selectOption({ label: 'From the CMS…' })
  await picker.locator('.cms-chips', { hasText: 'Privacy' }).waitFor()
  await picker.getByLabel('Field').selectOption({ label: 'Title' })
  await saved()
  await expect.poll(() => page.locator('.field-chip').textContent()).toBe('Legal › Privacy › Title')

  // Editing the entry shows on the canvas; deleting it is refused with where it is used.
  await page.getByRole('button', { name: 'CMS', exact: true }).click()
  await page.getByRole('button', { name: /^Legal/ }).click()
  const cms = page.getByRole('dialog', { name: 'CMS' })
  await cms.getByRole('button', { name: 'Privacy', exact: true }).click()
  await cms.getByLabel('Title', { exact: true }).fill('Privacy policy')
  await cms.getByRole('button', { name: 'Save', exact: true }).click()
  await saved()
  await cms.getByRole('button', { name: 'Delete', exact: true }).click()
  const confirm = cms.getByRole('alertdialog', { name: 'Confirm delete' })
  await confirm.getByText('is used and cannot be deleted').waitFor()
  expect(await confirm.locator('.asset-uses li').count()).toBe(2)
  await confirm.getByText('/privacy').first().waitFor()
  await page.screenshot({ path: shot('refused') })
  await confirm.getByRole('button', { name: 'OK' }).click()
  await page.keyboard.press('Escape')
  const title = canvas.locator('[data-lacuno-node="n-privacy-title"]')
  await expect.poll(() => title.textContent()).toBe('Privacy policy')

  // Unbinding keeps the text as it reads now, rich text included.
  await body.click()
  await inspector.getByLabel('Content from').selectOption({ label: 'Written text' })
  await saved()
  expect((await site()).nodes['n-privacy-body']).toMatchObject({ text: { type: 'doc' } })
  expect(await body.locator('h2').textContent()).toBe('1. Who we are')
  expect(await page.locator('.field-chip').count()).toBe(0)

  // The page's search title comes from the entry too.
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await pageSettings(page, 'Privacy')
  await page.getByLabel('SEO from entry').selectOption({ label: 'Privacy policy' })
  await page.getByLabel('SEO title from').selectOption({ label: 'Legal · Title' })
  await page.screenshot({ path: shot('seo') })
  await page.getByRole('button', { name: 'Save page' }).click()
  await saved()
  expect((await site()).pages['p-privacy']!.seo).toEqual({
    entry: 'e-privacy',
    fields: { title: 'f-legal-title' },
  })

  // Publishing resolves the title from the entry.
  const live = await publish()
  const html = await (await server.published!.request(`${live}/privacy`)).text()
  expect(html).toContain('>Privacy policy</h1>')
  expect(html).toContain('<title>Privacy policy</title>')
  expect(html).toContain('<h2>1. Who we are</h2>')
  expect(errors).toEqual([])
}, 180_000)
