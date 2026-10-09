import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('prefills a prompt about the selection, follows edits into both links, copies it, and offers no chip on a locked element', async () => {
  const { context, origin, page, canvas, siteId, document } = await editor({
    width: 1200,
    height: 1000,
  })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  let writes = 0
  page.on('request', (request) => {
    if (request.url().endsWith('/document/apply')) writes++
  })
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  await cta.click()
  const label = (await canvas.locator('.bar-top .name').textContent())!
  await canvas.getByRole('button', { name: 'Ask AI', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Ask your AI about ${label}` })
  await dialog.waitFor()
  const prompt = dialog.getByLabel('Prompt', { exact: true })
  const text = await prompt.inputValue()
  expect(text).toContain('on the site "Test site"')
  expect(text).toContain('open the page "Home" (/)')
  expect(text).toContain(`look at the ${label} (element n-home-cta)`)
  const query = async (name: string) => {
    const link = dialog.getByRole('link', { name, exact: true })
    expect(await link.getAttribute('target')).toBe('_blank')
    expect(await link.getAttribute('rel')).toContain('noopener')
    return new URL((await link.getAttribute('href'))!).searchParams.get('q')
  }
  expect(await query('Open in claude.ai')).toBe(text)
  expect(await query('Open in ChatGPT')).toBe(text)
  await prompt.fill('Make the button green & round.')
  expect(await query('Open in claude.ai')).toBe('Make the button green & round.')
  expect(await query('Open in ChatGPT')).toBe('Make the button green & round.')
  await dialog.getByRole('button', { name: 'Copy prompt', exact: true }).click()
  await expect.poll(() => dialog.getByRole('status').textContent()).toBe('Prompt copied.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'Make the button green & round.',
  )
  await page.keyboard.press('Escape')
  await expect.poll(() => dialog.count()).toBe(0)
  // The dialog holds no state: reopened, the prompt starts over, and nothing was written.
  await canvas.getByRole('button', { name: 'Ask AI', exact: true }).click()
  await dialog.waitFor()
  expect(await prompt.inputValue()).toBe(text)
  await dialog.getByRole('button', { name: 'Close ask your AI', exact: true }).click()
  await expect.poll(() => dialog.count()).toBe(0)
  expect(writes).toBe(0)

  // An agent locks the hero from outside; the CTA inherits the lock and loses the chip.
  const response = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
    data: {
      expectedRevision: (await document()).revision,
      operations: [{ type: 'node.update', id: 'n-home-hero', meta: { locked: true } }],
    },
  })
  expect(response.status()).toBe(200)
  await expect.poll(() => canvas.locator('.bar-top .field').textContent()).toBe('Locked')
  expect(await canvas.getByRole('button', { name: 'Ask AI', exact: true }).count()).toBe(0)
  expect(errors).toEqual([])
}, 60_000)
