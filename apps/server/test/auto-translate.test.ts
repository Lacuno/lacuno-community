import path from 'node:path'
import type { Page } from 'playwright'
import { expect, it } from 'vitest'
import { editor, root } from './harness.js'

const shot = (page: Page, name: string) =>
  page.screenshot({ path: path.join(root, `.lacuno/editor-preview/auto-translate-${name}.png`) })

/** A site in English and German, its Translations panel open. */
async function twoLanguages() {
  const opened = await editor()
  const { api, siteId, document, page } = opened
  await api(`/api/sites/${siteId}/document/apply`, {
    expectedRevision: (await document()).revision,
    operations: [{ type: 'locale.add', code: 'de' }],
  })
  return { ...opened, panel: () => openPanel(page) }
}

async function openPanel(page: Page) {
  await page.reload()
  await page.getByRole('button', { name: 'Translations', exact: true }).click()
  await page.locator('.translations-counts').first().waitFor()
}

it('translates with your own AI when the server names no auto-translate service', async () => {
  const { page, panel, siteId } = await twoLanguages()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const calls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('translate')) calls.push(request.url())
  })
  await panel()
  await page
    .locator('.translations-toolbar')
    .getByRole('button', { name: 'Auto-translate', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Translate with your own AI' })
  await dialog
    .getByText('Connect Claude, ChatGPT or another AI app to this site and paste this prompt.')
    .waitFor()
  const prompt = dialog.getByLabel('Prompt', { exact: true })
  expect(await prompt.inputValue()).toBe(
    `In Lacuno, on site ${siteId}, translate the site into Deutsch (de): use translations.list and translations.apply, following the site's glossary and tone (guide translate). Check the result with page.preview, then tell me what you translated and what you left.`,
  )
  await shot(page, 'own-ai')
  // The lead links the Connect panel.
  await dialog.getByRole('button', { name: 'Connect your AI', exact: true }).click()
  const connect = page.getByRole('dialog', { name: 'Connect your AI' })
  await connect.waitFor()
  await page.keyboard.press('Escape')
  await expect.poll(() => connect.count()).toBe(0)
  await dialog.getByRole('button', { name: 'Close ask your AI', exact: true }).click()
  // One page, from its group; and the language from the picker's menu.
  await page.getByRole('button', { name: 'Auto-translate Home', exact: true }).click()
  expect(await prompt.inputValue()).toContain(
    'translate page p-home into Deutsch (de): use translations.list with page p-home and',
  )
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Language', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Deutsch/ }).click()
  await page.getByRole('button', { name: 'Language', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Auto-translate', exact: true }).click()
  expect(await prompt.inputValue()).toContain('translate page p-home into Deutsch (de)')
  expect(calls).toEqual([])
  expect(errors).toEqual([])
})

it('follows a configured auto-translate service: not available, then a job to the end, or cancelled', async () => {
  const { page, panel, siteId } = await twoLanguages()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), autoTranslate: '/at' } })
  })
  let status: object = {
    available: false,
    reason: 'Auto-translate comes with a bigger allowance.',
    upgradeUrl: 'https://example.test/upgrade',
  }
  const statusAsked: string[] = []
  await page.route('**/at/status?*', (route) => {
    statusAsked.push(new URL(route.request().url()).searchParams.get('site')!)
    return route.fulfill({ json: status })
  })
  const started: unknown[] = []
  const cancelled: string[] = []
  let polls = 0
  await page.route('**/at/jobs', (route) => {
    started.push(route.request().postDataJSON())
    return route.fulfill({
      json: { job: { id: `j${started.length}`, status: 'queued', done: 0, total: 3 } },
    })
  })
  await page.route('**/at/jobs/*', (route) => {
    const id = route.request().url().split('/').pop()!
    if (route.request().method() === 'DELETE') {
      cancelled.push(id)
      return route.fulfill({ json: { job: { id, status: 'cancelled', done: 1, total: 3 } } })
    }
    polls++
    const done = id === 'j1' ? Math.min(polls, 3) : 1
    const state = done === 3 ? 'done' : 'running'
    return route.fulfill({ json: { job: { id, status: state, done, total: 3 } } })
  })

  // Not available: the service's reason, Upgrade at its address, and your own AI instead.
  await panel()
  await expect.poll(() => statusAsked).toEqual([siteId])
  const toolbar = page.locator('.translations-toolbar')
  await toolbar.getByRole('button', { name: 'Auto-translate', exact: true }).click()
  const unavailable = page.getByRole('dialog', { name: 'Auto-translate is not available' })
  await unavailable.getByText('Auto-translate comes with a bigger allowance.').waitFor()
  const upgrade = unavailable.getByRole('link', { name: 'Upgrade', exact: true })
  expect(await upgrade.getAttribute('href')).toBe('https://example.test/upgrade')
  expect(await upgrade.getAttribute('target')).toBe('_blank')
  await shot(page, 'not-available')
  await unavailable.getByRole('button', { name: 'Use your own AI', exact: true }).click()
  const own = page.getByRole('dialog', { name: 'Translate with your own AI' })
  await own.waitFor()
  // Closing asks the service again.
  status = { available: true }
  await own.getByRole('button', { name: 'Close ask your AI', exact: true }).click()
  await expect.poll(() => statusAsked.length).toBe(2)

  // Available: languages can be kept in sync, ...
  await page.getByRole('button', { name: 'Pages', exact: true }).click()
  await page.getByRole('button', { name: 'Site settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Site settings' })
  await settings.getByRole('checkbox', { name: 'Keep in sync' }).waitFor()
  await settings.getByRole('button', { name: 'Close', exact: true }).click()

  // ... and a job runs with its progress, closing on done.
  await page.getByRole('button', { name: 'Translations', exact: true }).click()
  await toolbar.getByRole('button', { name: 'Auto-translate', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Auto-translate into Deutsch' })
  const count = dialog.getByRole('status')
  await expect.poll(() => count.textContent()).toMatch(/^\d+ values, \d+ words$/)
  const missing = await count.textContent()
  await dialog.getByLabel('Everything missing or outdated').check()
  expect(await count.textContent()).toBe(missing)
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click()
  await expect.poll(() => count.textContent()).toBe('1 / 3 translated')
  await shot(page, 'progress')
  await expect.poll(() => dialog.count(), { timeout: 10_000 }).toBe(0)
  await page.getByText('Translated 3 values into Deutsch.').waitFor()
  expect(started).toEqual([{ site: siteId, locale: 'de', scope: 'all' }])

  // One page, cancelled.
  await page.getByRole('button', { name: 'Auto-translate Home', exact: true }).click()
  await dialog.getByLabel('This page: Home').waitFor()
  expect(await dialog.getByLabel('This page: Home').isChecked()).toBe(true)
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click()
  await expect.poll(() => count.textContent()).toBe('1 / 3 translated')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect.poll(() => dialog.count()).toBe(0)
  expect(started[1]).toEqual({ site: siteId, locale: 'de', scope: 'page', page: 'p-home' })
  expect(cancelled).toEqual(['j2'])
  expect(errors).toEqual([])
}, 60_000)
