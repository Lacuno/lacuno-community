import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('uploads a font in site settings, picks it in the Font control and publishes it self-hosted', async () => {
  const { server, page, canvas, document, publish, saved } = await editor()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const heading = canvas.locator('[data-lacuno-node="n-home-title"]')
  await heading.waitFor()

  // A stub WOFF2: the server types it by its signature; browsers cannot parse it, so the
  // test checks the CSS and the computed family rather than a loaded face.
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: 'Site settings', exact: true }).click()
  const site = page.getByRole('dialog', { name: 'Site settings' })
  await site.getByLabel('Upload font', { exact: true }).setInputFiles({
    name: 'TestSans-Bold.woff2',
    mimeType: '',
    buffer: Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(60)]),
  })
  const form = site.locator('.font-form')
  expect(await form.getByLabel('Family', { exact: true }).inputValue()).toBe('TestSans')
  expect(await form.getByLabel('Weight', { exact: true }).inputValue()).toBe('700')
  await form.getByLabel('Family', { exact: true }).fill('Test Sans')
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await saved()
  await site.getByRole('button', { name: 'Remove Test Sans Bold', exact: true }).waitFor()
  await expect.poll(() => site.locator('.font-face').allTextContents()).toContain('Bold×')
  // A variable face of the same family, italic so the regular preload stays the bold file.
  await site.getByLabel('Upload font', { exact: true }).setInputFiles({
    name: 'TestSans-Variable.woff2',
    mimeType: '',
    buffer: Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(61)]),
  })
  expect(await form.getByLabel('Variable font', { exact: true }).isChecked()).toBe(true)
  expect(await form.getByLabel('From', { exact: true }).inputValue()).toBe('100')
  expect(await form.getByLabel('To', { exact: true }).inputValue()).toBe('900')
  await form.getByLabel('Family', { exact: true }).fill('Test Sans')
  await form.getByLabel('Style', { exact: true }).selectOption('italic')
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await saved()
  await expect
    .poll(() => site.locator('.font-face').allTextContents())
    .toContain('Variable Italic×')
  await site.getByRole('button', { name: 'Close', exact: true }).click()

  const value = '"Test Sans", sans-serif'
  const stacks = ['system-ui, sans-serif', 'Georgia, serif', 'ui-monospace, monospace']
  const font = page.getByLabel('Font', { exact: true })
  const options = () => font.locator('option').allTextContents()
  await heading.click()
  expect(await options()).toEqual([
    'Inherited · Arial, Helvetica, sans-serif',
    'Arial, Helvetica, sans-serif',
    value,
    ...stacks,
  ])
  await font.selectOption(value)
  await saved()
  await expect
    .poll(() =>
      heading.evaluate((el) => getComputedStyle(el.querySelector('span') ?? el).fontFamily),
    )
    .toMatch(/^"Test Sans"/)
  expect(
    await canvas
      .locator('style')
      .evaluateAll((styles) => styles.map((style) => style.textContent).join('')),
  ).toContain('font-family:"Test Sans"')

  expect(JSON.stringify(await document())).toContain(JSON.stringify(value).slice(1, -1))
  const live = await publish()
  const home = await (await server.published!.request(`${live}/`)).text()
  const href = home.match(/<link rel="preload" as="font" type="font\/woff2" href="([^"]+)"/)?.[1]
  expect(href).toMatch(/\.woff2$/)
  expect(home).toContain(
    `@font-face{font-family:"Test Sans";src:url("${href}") format("woff2");font-weight:700;font-style:normal;font-display:swap}`,
  )
  expect(home).toContain('font-weight:100 900;font-style:italic')
  const file = await server.published!.request(`${live}${href}`)
  expect(file.status).toBe(200)
  expect(file.headers.get('content-type')).toBe('font/woff2')

  // Removing the face drops the family from the list; the heading keeps its value.
  await page.getByRole('button', { name: 'Site settings', exact: true }).click()
  await site.getByRole('button', { name: 'Remove Test Sans Bold', exact: true }).click()
  await saved()
  await site.getByRole('button', { name: 'Remove Test Sans Variable Italic', exact: true }).click()
  await saved()
  await expect.poll(() => site.locator('.font-list').textContent()).not.toContain('Test Sans')
  await site.getByRole('button', { name: 'Close', exact: true }).click()
  await heading.click()
  expect(await font.inputValue()).toBe(value)
  expect(await options()).toEqual(['Inherited', value, 'Arial, Helvetica, sans-serif', ...stacks])
  expect(errors).toEqual([])
}, 240_000)
