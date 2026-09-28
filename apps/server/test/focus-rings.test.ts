import { expect, it } from 'vitest'
import { clippedFocusRings, editor } from './harness.js'

it('keeps every focus ring in the CMS, asset manager, inspector and panels in view', async () => {
  const { page, canvas, api, siteId, document: site } = await editor()
  // A field of each kind, so the entry form shows every input.
  const kinds = [
    ['cover', 'Cover', 'image'],
    ['notes', 'Notes', 'richtext'],
    ['featured', 'Featured', 'boolean'],
    ['tint', 'Tint', 'color'],
    ['related', 'Related', 'reference'],
    ['kind', 'Kind', 'option'],
  ]
  const applied = await api(`/api/sites/${siteId}/document/apply`, {
    expectedRevision: (await site()).revision,
    operations: kinds.map(([name, label, type]) => ({
      type: 'field.add',
      collection: 'col-posts',
      field: {
        id: `f-${name}`,
        name,
        label,
        type,
        ...(type === 'reference' ? { reference: 'col-posts' } : {}),
        ...(type === 'option' ? { options: [{ value: 'news' }] } : {}),
      },
    })),
  })
  expect(applied.status).toBe(200)
  await page.reload()

  const cms = 'dialog.cms-manager'
  await page.getByRole('button', { name: 'CMS', exact: true }).click()
  await page.getByRole('button', { name: 'New collection' }).click()
  const dialog = page.getByRole('dialog', { name: 'CMS' })
  await dialog.getByLabel('New collection name').waitFor()
  expect(await clippedFocusRings(page, cms)).toEqual([])
  await dialog.getByRole('button', { name: /^Posts/ }).click()
  await dialog.locator('.cms-table').waitFor()
  expect(await clippedFocusRings(page, cms)).toEqual([])
  await dialog.getByRole('tab', { name: 'Fields and settings' }).click()
  await dialog.getByRole('button', { name: /^Title, Text/ }).click()
  await dialog.getByRole('button', { name: 'Add field' }).click()
  expect(await clippedFocusRings(page, cms)).toEqual([])
  await dialog.getByRole('tab', { name: 'Entries' }).click()
  await dialog.locator('.cms-open').first().click()
  await dialog.getByRole('textbox', { name: 'Notes' }).waitFor()
  expect(await clippedFocusRings(page, cms)).toEqual([])
  await dialog.getByRole('button', { name: 'Close CMS' }).click()

  await page.getByRole('button', { name: 'Assets', exact: true }).click()
  expect(await clippedFocusRings(page, '.layers-panel')).toEqual([])
  await page.getByRole('button', { name: 'Manage', exact: true }).click()
  await page.locator('dialog.asset-manager .asset-tile').first().click()
  expect(await clippedFocusRings(page, 'dialog.asset-manager')).toEqual([])
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  expect(await clippedFocusRings(page, '.layers-panel')).toEqual([])
  await canvas.locator('h1').first().click()
  await page.locator('aside.inspector details').first().waitFor()
  await page.locator('aside.inspector details').evaluateAll((sections) => {
    for (const section of sections) (section as HTMLDetailsElement).open = true
  })
  expect(await clippedFocusRings(page, 'aside.inspector')).toEqual([])
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  expect(await clippedFocusRings(page, '.layers-panel')).toEqual([])
})

it('rings a rich-text field once, inside its border, below its label', async () => {
  const { page } = await editor()
  await page.getByRole('button', { name: 'CMS', exact: true }).click()
  await page.locator('.page-link', { hasText: 'Posts' }).click()
  const dialog = page.getByRole('dialog', { name: 'CMS' })
  await dialog.locator('.cms-open').first().click()
  const field = dialog.locator('.cms-field[data-type="richtext"]').first()
  const ring = (selector: string) =>
    field.locator(selector).evaluate((element) => {
      const style = getComputedStyle(element)
      return style.outlineStyle === 'none'
        ? 0
        : Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
    })

  await field.getByRole('textbox').click()
  // Drawn on the field, within its border, so it neither covers the label nor meets an edge.
  expect(await ring('.rich-field')).toBe(0)
  const label = (await field.locator('legend').boundingBox())!
  const box = (await field.locator('.rich-field').boundingBox())!
  expect(label.y + label.height).toBeLessThanOrEqual(box.y)

  // A focused tool rings itself, inside its own box, and the field shows no second ring.
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => field.locator('.rich-field-tools button:focus').count()).toBe(1)
  expect(await ring('.rich-field-tools button:focus')).toBeLessThanOrEqual(0)
  expect(
    await field
      .locator('.rich-field')
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe('none')
})
