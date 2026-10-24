import path from 'node:path'
import { expect, it } from 'vitest'
import { editor, root } from './harness.js'

it('protects the testing site from the publish dialog, and a visitor unlocks it', async () => {
  const { context, page } = await editor()
  const dialog = page.locator('.publish-dialog')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await dialog.getByRole('button', { name: 'Publish v1 to testing', exact: true }).click()
  const link = dialog.getByRole('link', { name: 'Open testing site' })
  await link.waitFor({ timeout: 60_000 })
  const testingUrl = (await link.getAttribute('href'))!

  const section = dialog.locator('.site-passwords')
  const testing = section.getByRole('switch', { name: 'Testing site' })
  expect(await testing.getAttribute('aria-checked')).toBe('false')
  await testing.click()
  const field = section.getByLabel('Testing site password')
  await field.fill('short')
  expect(await section.getByRole('button', { name: 'Save' }).isDisabled()).toBe(true)
  await field.fill('open sesame')
  await section.getByRole('button', { name: 'Save' }).click()
  await section.getByRole('button', { name: 'Change' }).waitFor()
  expect(await field.inputValue()).toBe('')
  expect(
    await section.getByRole('switch', { name: 'Live site' }).getAttribute('aria-checked'),
  ).toBe('false')
  await section.screenshot({ path: path.join(root, '.lacuno/editor-preview/password-section.png') })

  const visitor = await context.browser()!.newContext()
  const tab = await visitor.newPage()
  const response = await tab.goto(`${testingUrl}/?from=link`)
  expect(response?.status()).toBe(401)
  expect(await tab.locator('h1').textContent()).toBe('Test site')
  await tab.getByLabel('Password').fill('wrong password')
  await tab.getByRole('button', { name: 'Continue' }).click()
  await tab.getByText('That password is not right.').waitFor()
  await tab.screenshot({ path: path.join(root, '.lacuno/editor-preview/password-page.png') })
  await tab.getByLabel('Password').fill('open sesame')
  await tab.getByRole('button', { name: 'Continue' }).click()
  await expect.poll(() => tab.url()).toBe(`${testingUrl}/?from=link`)
  expect(await tab.locator('h1').first().textContent()).toBe('Your website. Your rules.')

  // Turning the password off opens the site again.
  await testing.click()
  await expect.poll(() => testing.getAttribute('aria-checked')).toBe('false')
  const open = await (await context.browser()!.newContext()).newPage()
  expect((await open.goto(testingUrl))?.status()).toBe(200)
}, 240_000)
