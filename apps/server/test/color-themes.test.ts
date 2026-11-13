import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('makes a colour theme, changes it on the canvas, renames it, uses it for the site and deletes it', async () => {
  const { page, canvas, document } = await editor({ width: 1200, height: 1000 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await canvas.locator('[data-lacuno-node="n-home-cta"]').waitFor()
  const background = () =>
    canvas
      .locator('html')
      .evaluate((root) => getComputedStyle(root).getPropertyValue('--color-paper').trim())
  const bg = async () => (await document()).designTokens['t-color-paper']!.values
  const sage = async () => (await document()).site.modes.find((mode) => mode.label === 'Sage')?.id

  const tokens = page.getByRole('dialog', { name: 'Design tokens' })
  await page.getByRole('button', { name: 'Design tokens', exact: true }).click()
  // A chip per theme, the site's own colours first; the chosen one is pressed.
  const chips = tokens.getByRole('group', { name: 'Theme' }).getByRole('button')
  const chosen = () => chips.and(tokens.locator('[aria-pressed="true"]')).textContent()
  await expect.poll(() => chips.allTextContents()).toEqual(['Original', 'New theme'])

  // A new theme has a name alone: no selector and no media, so the published site ignores it.
  await tokens.getByRole('button', { name: 'New theme', exact: true }).click()
  await tokens.getByLabel('Theme name', { exact: true }).fill('Sage')
  await tokens.getByRole('button', { name: 'Create theme', exact: true }).click()
  await expect.poll(sage).toBeTruthy()
  const id = (await sage())!
  expect((await document()).site.modes.at(-1)).toEqual({ id, label: 'Sage' })
  await expect.poll(chosen).toBe('Sage')

  // It starts as the original; a colour changed in it shows on the canvas and saves for it alone.
  await tokens.getByRole('button', { name: 'Paper', exact: true }).click()
  await tokens.getByText('Same as the original').waitFor()
  await tokens.getByLabel('Color value', { exact: true }).fill('#e8efe6')
  await expect.poll(background).toBe('#e8efe6')
  await expect.poll(async () => (await bg())[id]).toEqual({ type: 'color', value: '#e8efe6' })
  expect((await bg()).light).toEqual({ type: 'color', value: '#f6f4ee' })
  await expect.poll(() => tokens.getByRole('status').textContent()).toBe('All changes saved')

  // Original shows the site's own colours again, and the theme its own.
  await chips.filter({ hasText: /^Original$/ }).click()
  await expect.poll(background).toBe('#f6f4ee')
  await expect
    .poll(() => tokens.getByLabel('Color value', { exact: true }).inputValue())
    .toBe('#f6f4ee')
  await chips.filter({ hasText: /^Sage$/ }).click()
  await expect.poll(background).toBe('#e8efe6')

  // Reset to original takes the theme's value away; then set it again.
  await tokens.getByRole('button', { name: 'Reset to original', exact: true }).click()
  await tokens.getByText('Same as the original').waitFor()
  await expect.poll(async () => (await bg())[id]).toBeUndefined()
  await expect.poll(background).toBe('#f6f4ee')
  await tokens.getByLabel('Color value', { exact: true }).fill('#e8efe6')
  await expect.poll(async () => (await bg())[id]).toEqual({ type: 'color', value: '#e8efe6' })
  await expect.poll(() => tokens.getByRole('status').textContent()).toBe('All changes saved')

  await tokens.getByRole('button', { name: 'Rename', exact: true }).click()
  await tokens.getByLabel('Theme name', { exact: true }).fill('Salbei')
  await tokens.getByRole('button', { name: 'Rename theme', exact: true }).click()
  await expect.poll(() => chips.allTextContents()).toEqual(['Original', 'Salbei', 'New theme'])

  // The theme's colours become the site's own; the theme stays.
  await tokens.getByRole('button', { name: 'Use as the site’s colors', exact: true }).click()
  await expect.poll(async () => (await bg()).light).toEqual({ type: 'color', value: '#e8efe6' })
  expect((await bg())[id]).toEqual({ type: 'color', value: '#e8efe6' })

  await tokens.getByRole('button', { name: 'Delete theme', exact: true }).click()
  await expect.poll(() => chips.allTextContents()).toEqual(['Original', 'New theme'])
  await expect.poll(chosen).toBe('Original')
  expect(Object.keys(await bg())).toEqual(['light'])
  expect((await document()).site.modes.map((mode) => mode.id)).toEqual(['light'])
  await tokens.getByRole('button', { name: 'Close tokens', exact: true }).click()
  await expect.poll(background).toBe('#e8efe6')
  expect(errors).toEqual([])
})
