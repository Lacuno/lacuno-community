import { expect, it } from 'vitest'
import { clippedFocusRings, editor, openFormatting } from './harness.js'

it('edits visual grid tracks and gaps, switches only mobile to a stack, and undoes the whole switch', async () => {
  const { page, canvas, saved, document } = await editor()
  const grid = canvas.locator('[data-lacuno-node="n-home-choice-grid"]')
  await grid.dispatchEvent('click')
  await openFormatting(page, 'Layout')
  const children = (await document()).nodes['n-home-choice-grid']!.children
  await page.getByRole('button', { name: 'Grid layout', exact: true }).click()
  await page.getByRole('button', { name: 'Narrow left column', exact: true }).click()
  await saved()
  const columns = () =>
    grid.evaluate((el) =>
      getComputedStyle(el).gridTemplateColumns.split(' ').map(Number.parseFloat),
    )
  await expect
    .poll(async () => {
      const [a, b] = await columns()
      return Math.round(b! / a!)
    })
    .toBe(2)
  await page.getByLabel('Horizontal gap', { exact: true }).fill('24')
  await page.getByLabel('Vertical gap', { exact: true }).fill('32')
  await saved()
  await expect
    .poll(() =>
      grid.evaluate((el) => [getComputedStyle(el).columnGap, getComputedStyle(el).rowGap]),
    )
    .toEqual(['24px', '32px'])
  expect((await document()).nodes['n-home-choice-grid']!.children).toEqual(children)
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect
    .poll(() => page.getByLabel('Editing breakpoint').locator('option:checked').textContent())
    .toContain('Mobile')
  await page.getByRole('button', { name: 'Stack layout', exact: true }).click()
  await saved()
  await expect
    .poll(() =>
      grid.evaluate((el) => [getComputedStyle(el).display, getComputedStyle(el).flexDirection]),
    )
    .toEqual(['flex', 'column'])
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await expect.poll(() => grid.evaluate((el) => getComputedStyle(el).display)).toBe('grid')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await saved()
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect.poll(() => grid.evaluate((el) => getComputedStyle(el).display)).toBe('grid')
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await page.reload()
  await grid.dispatchEvent('click')
  await openFormatting(page, 'Layout')
  await expect
    .poll(async () => {
      const [a, b] = await columns()
      return Math.round(b! / a!)
    })
    .toBe(2)
  expect(await clippedFocusRings(page, '.layout-controls')).toEqual([])
}, 60_000)

it('preserves custom grid CSS and edits children in their parent context', async () => {
  const { page, canvas, saved } = await editor()
  const grid = canvas.locator('[data-lacuno-node="n-home-choice-grid"]')
  await grid.dispatchEvent('click')
  await openFormatting(page, 'Layout')
  await page.getByRole('button', { name: 'Grid layout', exact: true }).click()
  await page.locator('.layout-advanced > summary').click()
  await page.getByLabel('Grid columns', { exact: true }).fill('minmax(100px, 1fr) 2fr')
  await saved()
  expect(await page.getByText('Custom grid preserved.', { exact: false }).isVisible()).toBe(true)
  await page.getByRole('button', { name: 'Row layout', exact: true }).click()
  await saved()
  await page.getByRole('button', { name: 'Grid layout', exact: true }).click()
  await saved()
  expect(await page.getByLabel('Grid columns', { exact: true }).inputValue()).toBe(
    'minmax(100px, 1fr) 2fr',
  )
  const child = grid.locator(':scope > [data-lacuno-node]').first()
  await child.dispatchEvent('click')
  await openFormatting(page, 'Layout')
  await page.getByRole('button', { name: 'Width: Fill space', exact: true }).click()
  await saved()
  await page.getByLabel('Column span', { exact: true }).selectOption('1 / -1')
  await saved()
  await expect.poll(() => child.evaluate((el) => getComputedStyle(el).gridColumn)).toBe('1 / -1')
  await page.locator('.layout-parent').click()
  await expect.poll(() => grid.getAttribute('data-lacuno-selected')).toBe('')
}, 60_000)

it('aligns rows and stacks, binds gap tokens, and sizes children through their parent', async () => {
  const { page, canvas, saved, document } = await editor()
  const grid = canvas.locator('[data-lacuno-node="n-home-choice-grid"]')
  await grid.dispatchEvent('click')
  await openFormatting(page, 'Layout')
  await page.getByRole('button', { name: 'Row layout', exact: true }).click()
  await page.getByRole('button', { name: 'Align right top', exact: true }).click()
  await saved()
  await expect
    .poll(() =>
      grid.evaluate((el) => [getComputedStyle(el).justifyContent, getComputedStyle(el).alignItems]),
    )
    .toEqual(['flex-end', 'flex-start'])
  await page.getByRole('button', { name: 'Stack layout', exact: true }).click()
  await page.getByRole('button', { name: 'Align right top', exact: true }).click()
  await saved()
  await expect
    .poll(() =>
      grid.evaluate((el) => [getComputedStyle(el).justifyContent, getComputedStyle(el).alignItems]),
    )
    .toEqual(['flex-start', 'flex-end'])
  await page.getByRole('button', { name: 'Use a token for Vertical gap', exact: true }).click()
  await page.getByRole('menuitemradio').first().click()
  await saved()
  const doc = await document()
  expect(
    Object.values(doc.styles).find(
      (s) => doc.nodes['n-home-choice-grid']!.classes.includes(s.class) && s.property === 'row-gap',
    )?.value.type,
  ).toBe('designToken')
  await page.getByRole('button', { name: 'Row layout', exact: true }).click()
  await saved()
  const child = grid.locator(':scope > [data-lacuno-node]').first()
  await child.dispatchEvent('click')
  await openFormatting(page, 'Layout')
  await page.getByRole('button', { name: 'Width: Fill space', exact: true }).click()
  await saved()
  await expect.poll(() => child.evaluate((el) => getComputedStyle(el).flexGrow)).toBe('1')
  await page.getByRole('button', { name: 'Width: Fixed', exact: true }).click()
  await saved()
  await expect
    .poll(() =>
      child.evaluate((el) => [getComputedStyle(el).flexGrow, getComputedStyle(el).flexShrink]),
    )
    .toEqual(['0', '0'])
  await page.getByRole('button', { name: 'Width: Fit content', exact: true }).click()
  await saved()
  await expect.poll(() => child.evaluate((el) => getComputedStyle(el).flexGrow)).toBe('0')
}, 60_000)
