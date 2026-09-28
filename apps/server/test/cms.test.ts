import type { Page } from 'playwright'
import { expect, it } from 'vitest'
import { editor } from './harness.js'

/** A small PNG of one colour, drawn by the page. */
const png = (page: Page, color: string) =>
  page.evaluate((fill) => {
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 30
    const context = canvas.getContext('2d')!
    context.fillStyle = fill
    context.fillRect(0, 0, 40, 30)
    return canvas.toDataURL('image/png').split(',')[1]!
  }, color)

it('manages collections, fields and entries by hand', async () => {
  const { page, document: site, saved, api, siteId } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const authors = async () =>
    Object.values((await site()).collections).find((col) => col.name === 'Authors')!

  // A new collection starts with a title and the slug its addresses come from.
  await page.getByRole('button', { name: 'CMS', exact: true }).click()
  await page.getByRole('button', { name: 'New collection' }).click()
  const dialog = page.getByRole('dialog', { name: 'CMS' })
  await dialog.getByLabel('New collection name').fill('Authors')
  await dialog.getByLabel('New collection name').press('Enter')
  await saved()
  expect((await authors()).fields.map((field) => field.name)).toEqual(['title', 'slug'])
  expect((await authors()).slug).toBe('authors')

  // Fields: add one of each kind the form needs, then rename and reorder.
  const addField = async (label: string, type: string) => {
    await dialog.getByRole('button', { name: 'Add field' }).click()
    await dialog.getByLabel('Field label').fill(label)
    await dialog.getByLabel('Field type').selectOption({ label: type })
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await saved()
  }
  await addField('Photo', 'Image')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await addField('Bio', 'Rich text')
  await addField('Active', 'Switch')
  await addField('Role', 'Option')
  const roleForm = dialog.locator('.cms-field-form')
  await roleForm.getByLabel('Option 1 label').fill('Designer')
  await roleForm.getByRole('button', { name: 'Add option' }).click()
  await roleForm.getByLabel('Option 2 label').fill('Writer')
  await roleForm.getByRole('button', { name: 'Save field' }).click()
  await saved()
  const role = (await authors()).fields.find((field) => field.name === 'role')!
  expect(role.type === 'option' && role.options).toEqual([
    { value: 'designer', label: 'Designer' },
    { value: 'writer', label: 'Writer' },
  ])
  await dialog.getByRole('button', { name: /^Title, Text/ }).click()
  await dialog.locator('.cms-field-form').getByLabel('Label').fill('Name')
  await dialog.locator('.cms-field-form').getByLabel('Name', { exact: true }).fill('name')
  await dialog.getByRole('button', { name: 'Save field' }).click()
  await saved()
  await dialog.getByRole('button', { name: 'Move Photo up' }).click()
  await saved()
  expect((await authors()).fields.map((field) => field.name)).toEqual([
    'name',
    'photo',
    'slug',
    'bio',
    'active',
    'role',
  ])

  // An entry with every input: the slug follows the name, the photo is uploaded right here.
  await dialog.getByRole('tab', { name: 'Entries' }).click()
  await dialog.getByText('No entries yet.', { exact: false }).waitFor()
  await dialog.getByRole('button', { name: 'New entry' }).click()
  await dialog.getByLabel('Name', { exact: true }).fill('Ada Lovelace')
  expect(await dialog.getByLabel('Slug', { exact: true }).inputValue()).toBe('ada-lovelace')
  await dialog.getByLabel('Upload photo').setInputFiles({
    name: 'ada.png',
    mimeType: 'image/png',
    buffer: Buffer.from(await png(page, 'teal'), 'base64'),
  })
  await dialog.locator('.cms-asset strong', { hasText: 'ada.png' }).waitFor()
  const bio = dialog.getByRole('textbox', { name: 'Bio' })
  await bio.click()
  await page.keyboard.type('First programmer')
  await page.keyboard.press('ControlOrMeta+a')
  await dialog.getByRole('button', { name: 'Bold' }).click()
  await dialog.getByRole('switch', { name: 'Active' }).click()
  await dialog.getByLabel('Role', { exact: true }).selectOption('writer')
  await dialog.getByRole('button', { name: 'Create entry' }).click()
  await saved()
  let col = await authors()
  const field = (name: string) => col.fields.find((item) => item.name === name)!.id
  const ada = (await site()).entries[col.id]![0]!
  expect(ada.fields[field('slug')]).toBe('ada-lovelace')
  expect(ada.fields[field('active')]).toBe(true)
  expect(ada.fields[field('role')]).toBe('writer')
  expect((await site()).assets[ada.fields[field('photo')] as string]?.name).toBe('ada.png')
  expect(JSON.stringify(ada.fields[field('bio')])).toContain('"bold"')
  // The saved entry stays open.
  await dialog.getByRole('heading', { name: 'Ada Lovelace' }).waitFor()

  // A slug another entry uses is refused before saving.
  await dialog.getByRole('button', { name: 'Authors', exact: true }).first().click()
  await dialog.getByRole('button', { name: 'New entry' }).click()
  await dialog.getByLabel('Name', { exact: true }).fill('Ada Lovelace')
  expect(await dialog.getByLabel('Slug', { exact: true }).inputValue()).toBe('ada-lovelace-2')
  await dialog.getByLabel('Slug', { exact: true }).fill('ada-lovelace')
  await dialog.getByRole('button', { name: 'Create entry' }).click()
  await dialog.getByText('Another entry already uses the slug ada-lovelace.').waitFor()
  await dialog.getByLabel('Name', { exact: true }).fill('Grace Hopper')
  await dialog.getByLabel('Slug', { exact: true }).fill('grace')
  await dialog.getByRole('button', { name: 'Create entry' }).click()
  await saved()

  // Posts point at authors through a reference field, picked by searching.
  await dialog.getByRole('button', { name: /^Posts/ }).click()
  await dialog.getByRole('tab', { name: 'Fields and settings' }).click()
  await addField('Author', 'Reference')
  await dialog
    .locator('.cms-field-form')
    .getByLabel('Entries of')
    .selectOption({ label: 'Authors' })
  await dialog.getByRole('button', { name: 'Save field' }).click()
  await saved()
  await dialog.getByRole('tab', { name: 'Entries' }).click()
  await dialog.getByRole('button', { name: 'From document to website' }).click()
  const picker = dialog.getByRole('combobox', { name: 'Author' })
  await picker.fill('ada')
  await dialog.getByRole('option', { name: 'Ada Lovelace' }).waitFor()
  await picker.press('Enter')
  await dialog.locator('.cms-chips', { hasText: 'Ada Lovelace' }).waitFor()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await saved()
  const posts = (await site()).entries['col-posts']!
  const author = (await site()).collections['col-posts']!.fields.find((f) => f.name === 'author')!
  expect(
    posts.find((post) => post.fields['f-slug'] === 'from-document-to-website')!.fields[author.id],
  ).toBe(ada.id)

  // Something in use says where and stays: an entry, a field, a collection.
  await dialog.getByRole('button', { name: /^Authors/ }).click()
  await dialog.getByRole('button', { name: 'Ada Lovelace' }).click()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  const confirm = dialog.getByRole('alertdialog', { name: 'Confirm delete' })
  await confirm.getByText('From document to website').waitFor()
  await confirm.getByRole('button', { name: 'OK' }).click()
  await dialog.getByRole('button', { name: 'Authors', exact: true }).first().click()
  await dialog.getByRole('button', { name: 'Grace Hopper' }).click()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await saved()
  await dialog.getByText('Deleted Grace Hopper.').waitFor()
  expect((await site()).entries[col.id]).toHaveLength(1)
  await dialog.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  expect((await site()).entries[col.id]).toHaveLength(2)
  await dialog.getByRole('button', { name: /^Posts/ }).click()
  await dialog.getByRole('tab', { name: 'Fields and settings' }).click()
  await dialog.getByRole('button', { name: /^Title, Text/ }).click()
  await dialog.getByRole('button', { name: 'Delete field' }).click()
  await confirm.getByText('Blog', { exact: false }).first().waitFor()
  await confirm.getByRole('button', { name: 'OK' }).click()
  await dialog.getByRole('button', { name: 'Delete collection' }).click()
  await confirm.getByText('Article page').waitFor()
  await confirm.getByRole('button', { name: 'OK' }).click()

  // Hundreds of entries page by fifty; search and sort work across all of them.
  const { revision } = await site()
  const created = await api(`/api/sites/${siteId}/document/apply`, {
    expectedRevision: revision,
    operations: Array.from({ length: 120 }, (_, i) => ({
      type: 'entry.create',
      collection: col.id,
      fields: {
        [field('name')]: `Writer ${String(i + 1).padStart(3, '0')}`,
        [field('slug')]: `writer-${i + 1}`,
      },
    })),
  })
  expect(created.status).toBe(200)
  await dialog.getByRole('button', { name: /^Authors/ }).click()
  const pager = dialog.locator('.cms-pager')
  await expect.poll(() => pager.textContent()).toBe('1–50 of 122‹›')
  await dialog.getByRole('button', { name: 'Next page' }).click()
  await expect.poll(() => pager.textContent()).toBe('51–100 of 122‹›')
  await dialog.getByLabel('Search entries').fill('writer 11')
  await expect.poll(() => pager.textContent()).toBe('1–10 of 10')
  await dialog.getByRole('button', { name: 'Name', exact: true }).click()
  await dialog.getByRole('button', { name: 'Name', exact: true }).click()
  expect(await dialog.locator('.cms-open').first().textContent()).toBe('Writer 119')
  col = await authors()
  expect(errors).toEqual([])
})
