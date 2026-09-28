import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('opens a collection on its fields until it has entries, and lists it on a page to link to', async () => {
  const { page, canvas, server, document: site, saved, publish } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const dialog = page.getByRole('dialog', { name: 'CMS' })
  const tabs = dialog.getByRole('tab')
  const selectedTab = () => dialog.getByRole('tab', { selected: true }).textContent()

  // The definition comes first; a new collection opens on it.
  await page.getByRole('button', { name: 'CMS', exact: true }).click()
  await page.getByRole('button', { name: 'New collection' }).click()
  await dialog.getByLabel('New collection name').fill('Recipes')
  await dialog.getByLabel('New collection name').press('Enter')
  await saved()
  expect(await tabs.allTextContents()).toEqual(['Fields and settings', 'Entries'])
  expect(await selectedTab()).toBe('Fields and settings')

  await dialog.getByRole('tab', { name: 'Entries' }).click()
  await dialog.getByRole('button', { name: 'New entry' }).click()
  await dialog.getByLabel('Title', { exact: true }).fill('Pancakes')
  await dialog.getByRole('button', { name: 'Create entry' }).click()
  await saved()
  // With entries, a collection opens on them.
  await dialog.getByRole('button', { name: /^Posts/ }).click()
  expect(await selectedTab()).toBe('Entries')
  await dialog.getByRole('button', { name: /^Recipes/ }).click()
  expect(await selectedTab()).toBe('Entries')

  // A list page brings the entry pages its cards link to.
  await dialog.getByRole('tab', { name: 'Fields and settings' }).click()
  await dialog.getByRole('button', { name: 'Create a list page' }).click()
  await saved()
  const doc = await site()
  const col = Object.values(doc.collections).find((item) => item.name === 'Recipes')!
  const pages = Object.values(doc.pages)
  const list = pages.find((item) => item.path === '/recipes')!
  expect(list.name).toBe('Recipes')
  expect(pages.find((item) => item.path === '/recipes/[slug]')?.collection).toBe(col.id)
  expect(
    Object.values(doc.nodes).some(
      (node) => node.type === 'collection-list' && node.collection === col.id,
    ),
  ).toBe(true)

  // The settings link it, and open it on the canvas.
  await dialog.getByRole('button', { name: 'Recipes /recipes' }).click()
  await expect.poll(() => dialog.count()).toBe(0)
  await expect
    .poll(() => canvas.getByRole('link', { name: 'Read more' }).getAttribute('href'))
    .toBe('/recipes/pancakes')
  await expect.poll(() => canvas.locator('h3').textContent()).toBe('Pancakes')

  // The link picker offers the list page and each entry of an entry page.
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Button', exact: true }).click()
  await page.getByRole('button', { name: 'Insert element', exact: true }).click()
  await saved()
  const target = page.locator('.link-target-row')
  const choose = async (label: string) => {
    await target.getByRole('button', { name: 'Change', exact: true }).click()
    const picker = target.getByLabel('Link to page', { exact: true })
    await picker.selectOption({ label })
    return picker
  }
  const picker = await choose('Pancakes')
  expect(
    await picker
      .locator('optgroup')
      .evaluateAll((groups) => groups.map((group) => (group as HTMLOptGroupElement).label)),
  ).toEqual(['Pages', 'Posts', 'Recipes'])
  expect(await picker.locator('optgroup[label="Pages"] option').allTextContents()).toContain(
    'Recipes',
  )
  expect(await target.getByRole('textbox', { name: 'Link destination' }).count()).toBe(0)
  await target.getByRole('button', { name: 'Apply link', exact: true }).click()
  await saved()
  const button = canvas.getByRole('link', { name: 'Button', exact: true })
  await expect.poll(() => button.getAttribute('href')).toBe('/recipes/pancakes')
  await choose('Recipes')
  await target.getByRole('button', { name: 'Apply link', exact: true }).click()
  await saved()
  await expect.poll(() => button.getAttribute('href')).toBe('/recipes')

  // Published, the list links each entry to its page.
  const live = await publish()
  const html = async (path: string) => (await server.published!.request(live + path)).text()
  expect(await html('/recipes')).toMatch(/<a [^>]*href="\/recipes\/pancakes"[^>]*>Read more<\/a>/)
  expect(await html('/recipes/pancakes')).toContain('>Pancakes</h1>')
  expect(errors).toEqual([])
}, 120_000)
