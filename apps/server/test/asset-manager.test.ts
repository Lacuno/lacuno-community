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

it('manages assets: usage, alt text, guarded delete with undo, keyboard and drop upload', async () => {
  const { page, document: site, saved } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const names = async () => Object.values((await site()).assets).map((asset) => asset.name)

  // Several files in one go land one after another, each in its own batch.
  await page.getByRole('button', { name: 'Assets', exact: true }).click()
  await page.getByLabel('Upload image, video or font', { exact: true }).setInputFiles(
    await Promise.all(
      ['red', 'green', 'blue'].map(async (color) => ({
        name: `${color}.png`,
        mimeType: 'image/png',
        buffer: Buffer.from(await png(page, color), 'base64'),
      })),
    ),
  )
  await expect.poll(names).toEqual(expect.arrayContaining(['red.png', 'green.png', 'blue.png']))
  await page.getByRole('button', { name: 'Insert red.png', exact: true }).click()
  await saved()
  const redId = Object.values((await site()).assets).find((a) => a.name === 'red.png')!.id
  const imageId = Object.values((await site()).nodes).find(
    (node) => node.attrs?.src?.type === 'asset' && node.attrs.src.asset === redId,
  )!.id

  await page.getByRole('button', { name: 'Assets', exact: true }).click()
  await page.getByRole('button', { name: 'Manage', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Assets' })
  await expect
    .poll(() => dialog.getByLabel('Search assets').evaluate((e) => e === document.activeElement))
    .toBe(true)
  const tiles = dialog.getByRole('listbox', { name: 'Files' })
  const option = (name: string) => tiles.getByRole('option', { name: new RegExp(`^${name},`) })
  expect(await option('red.png').getAttribute('aria-label')).toBe('red.png, PNG image, used in 1')
  expect(await option('green.png').getAttribute('aria-label')).toBe(
    'green.png, PNG image, not used',
  )

  // A used file shows where it is used and cannot be deleted, not even with the Delete key.
  await option('red.png').click()
  const details = dialog.getByRole('complementary', { name: 'File details' })
  await details.getByText('Used in 1', { exact: true }).waitFor()
  expect(await details.getByText('40 × 30', { exact: true }).count()).toBe(1)
  expect(await details.getByRole('button', { name: 'Delete file' }).count()).toBe(0)
  await option('red.png').press('Delete')
  expect(await dialog.getByRole('alertdialog').count()).toBe(0)

  // The default alt text is the asset's own.
  await details.getByLabel('Default alt text').fill('A red square')
  await details.getByLabel('Default alt text').press('Enter')
  await saved()
  expect((await site()).assets[redId]!.alt).toBe('A red square')

  // Searching and sorting narrow and order the grid.
  await dialog.getByLabel('Search assets').fill('GREEN')
  await expect.poll(() => tiles.getByRole('option').count()).toBe(1)
  await dialog.getByLabel('Search assets').fill('')
  await dialog.getByLabel('Sort assets').selectOption('name')
  expect((await tiles.getByRole('option').first().getAttribute('aria-label'))!).toMatch(
    /^blue\.png/,
  )

  // Keyboard: arrows move the selection, Delete asks first, Escape cancels only the question.
  await option('blue.png').click()
  await option('blue.png').press('ArrowRight')
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
    .toMatch(/^favicon\.svg/)
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Delete')
  const confirm = dialog.getByRole('alertdialog', { name: 'Confirm delete' })
  await confirm.getByText('Delete blue.png?').waitFor()
  await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe('Delete')
  await page.keyboard.press('Escape')
  await confirm.waitFor({ state: 'detached' })
  expect(await dialog.isVisible()).toBe(true)
  await option('blue.png').press('Delete')
  await page.keyboard.press('Enter')
  await saved()
  expect(await names()).not.toContain('blue.png')
  await dialog.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  expect(await names()).toContain('blue.png')

  // Select unused picks every file nothing uses; the template's own files are all used.
  await dialog.getByRole('button', { name: 'Select unused', exact: true }).click()
  await dialog.getByText('2 files selected').waitFor()
  await dialog.getByRole('button', { name: 'Delete 2 files', exact: true }).click()
  expect(await confirm.locator('li').allTextContents()).toEqual(['blue.png', 'green.png'])
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await saved()
  expect(await names()).not.toContain('green.png')
  expect(await names()).toContain('red.png')
  await dialog.getByText('Deleted 2 files.').waitFor()

  // Files dropped onto the dialog upload like chosen ones.
  const data = await png(page, 'orange')
  const drag = (type: string) =>
    dialog.locator('.asset-manager-body').evaluate(
      (element, [type, base64]) => {
        const bytes = Uint8Array.from(atob(base64!), (char) => char.charCodeAt(0))
        const dataTransfer = new DataTransfer()
        dataTransfer.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }))
        element.dispatchEvent(
          new DragEvent(type!, { bubbles: true, cancelable: true, dataTransfer }),
        )
      },
      [type, data],
    )
  await drag('dragover')
  await dialog.getByText('Drop to upload').waitFor()
  await drag('drop')
  await option('dropped.png').waitFor()
  expect(await names()).toContain('dropped.png')

  // Showing a use selects the element on the canvas and closes the dialog.
  await option('red.png').click()
  await details.getByRole('button', { name: 'Show Image on Home' }).click()
  await dialog.waitFor({ state: 'detached' })
  await expect
    .poll(() => page.locator('.layer.selected').getAttribute('data-drag-node'))
    .toBe(imageId)

  // Escape closes the dialog.
  await page.getByRole('button', { name: 'Assets', exact: true }).click()
  await page.getByRole('button', { name: 'Manage', exact: true }).click()
  await dialog.waitFor()
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'detached' })
  expect(errors).toEqual([])
})
