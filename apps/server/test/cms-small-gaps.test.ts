import { expect, it } from 'vitest'
import { editor, pageSettings } from './harness.js'


it('formats bound dates, shows fields inside text and puts titles into the site template', async () => {
  const { page, canvas, document, saved, api, siteId, server, publish } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const inspector = page.locator('aside.inspector')
  const apply = async (operations: unknown[]) =>
    api(`/api/sites/${siteId}/document/apply`, {
      expectedRevision: (await document()).revision,
      operations,
    })
  const posts = (await document()).entries['col-posts']!
  const added = await apply([
    {
      type: 'field.add',
      collection: 'col-posts',
      field: { id: 'f-updated', name: 'updated', label: 'Last updated', type: 'date' },
    },
    // Each post's page takes its title from the post, inside the template below.
    { type: 'page.update', id: 'p-article', seo: { fields: { title: 'f-title' } } },
    ...posts.map((entry) => ({
      type: 'entry.update',
      collection: 'col-posts',
      id: entry.id,
      fields: { 'f-updated': '2026-09-28' },
    })),
  ])
  expect(added.status).toBe(200)

  // A bound date takes a format and a language of its own.
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.locator('.page-link').filter({ hasText: 'Article' }).click()
  const summary = canvas.locator('[data-lacuno-node="n-article-summary"]')
  await summary.click()
  await inspector.getByLabel('Content from').selectOption({ label: 'Posts · Last updated' })
  await saved()
  await expect.poll(() => summary.textContent()).toBe('2026-09-28')
  await inspector.getByLabel('Date format').selectOption('long')
  await saved()
  await expect.poll(() => summary.textContent()).toBe('September 28, 2026')
  await inspector.getByLabel('Date language').selectOption('de-AT')
  await saved()
  await expect.poll(() => summary.textContent()).toBe('28. September 2026')
  expect((await document()).nodes['n-article-summary']).toMatchObject({
    text: { type: 'field', field: 'f-updated', format: 'long', locale: 'de-AT' },
  })

  // A field inside written text, from a post chosen in the CMS, on a page of its own.
  await page.locator('.page-link').filter({ hasText: 'About' }).click()
  const text = canvas.locator('[data-lacuno-node="n-about-why-p1"]')
  await text.scrollIntoViewIfNeeded()
  await text.click()
  await text.dblclick()
  const editable = canvas.getByLabel('Canvas text editor')
  await editable.waitFor()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' Last updated: ')
  await inspector.getByLabel('Insert field').selectOption('pick')
  const picker = inspector.getByRole('group', { name: 'Choose from the CMS' })
  await picker.getByRole('combobox', { name: 'Entry' }).fill('belong')
  await picker.getByRole('option', { name: 'Your website should belong to you' }).click()
  await picker.getByLabel('Field').selectOption({ label: 'Last updated' })
  const chip = editable.locator('[data-lacuno-field]')
  await expect.poll(() => chip.textContent()).toBe('Last updated')
  await chip.click()
  await inspector.getByLabel('Date format').selectOption('long')
  // The field stays selected, so its language is one more choice away.
  await inspector.getByLabel('Date language').waitFor()
  await page.getByRole('button', { name: 'Done editing text', exact: true }).click()
  await saved()
  await expect.poll(() => text.textContent()).toMatch(/Last updated:\sSeptember 28, 2026$/)
  const written = JSON.stringify((await document()).nodes['n-about-why-p1'])
  expect(written).toContain(
    `{"type":"field","attrs":{"field":"f-updated","entry":"${posts[0]!.id}","format":"long"}}`,
  )

  // A field shown this way cannot be deleted, even once nothing else binds it.
  const refused = await apply([
    { type: 'node.update', id: 'n-article-summary', text: { type: 'field', field: 'f-summary' } },
    { type: 'field.remove', collection: 'col-posts', id: 'f-updated' },
  ])
  expect(refused.status).toBe(400)
  expect(await refused.text()).toContain('field f-updated is referenced')

  // Every title reads "<page> — Lacuno", but Home keeps its own.
  await page.getByRole('button', { name: 'Site settings', exact: true }).click()
  const site = page.getByRole('dialog', { name: 'Site settings' })
  const template = site.getByLabel('Title template', { exact: true })
  await template.fill('Lacuno')
  await template.press('Tab')
  await site.getByText('Put {page} where each page’s title goes.').waitFor()
  await template.fill('{page} — Lacuno')
  await template.press('Tab')
  await saved()
  await site.getByRole('button', { name: 'Close', exact: true }).click()
  await pageSettings(page, 'Home')
  const settings = page.getByRole('dialog', { name: 'Page settings' })
  const own = settings.getByRole('checkbox', { name: /^Title template · / })
  expect(await own.isChecked()).toBe(true)
  await own.uncheck()
  await settings.getByRole('button', { name: 'Save page', exact: true }).click()
  await saved()
  expect((await document()).pages['p-home']!.seo?.titleTemplate).toBe(false)

  const live = await publish()
  const title = async (route: string) =>
    (await (await server.published!.request(`${live}${route}`)).text()).match(
      /<title>(.*?)<\/title>/,
    )?.[1]
  expect(await title('/about')).toBe('About Lacuno — Own the site you make — Lacuno')
  expect(await title('/')).not.toContain('— Lacuno')
  expect(await title(`/blog/${posts[0]!.fields['f-slug']}`)).toBe(
    'Your website should belong to you — Lacuno',
  )
  expect(errors).toEqual([])
}, 180_000)
