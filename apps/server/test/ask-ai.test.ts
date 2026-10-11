import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('prefills a prompt about the selection, follows edits into the links, copies it, offers no chip on a locked element, and opens the page in Claude from the header', async () => {
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
  // The header's Open in Claude asks for the open page by id, names being the site's content,
  // at the address Claude needs a connector for.
  const open = page.locator('.editor-header').getByRole('link', { name: 'Open in Claude' })
  expect(await open.getAttribute('target')).toBe('_blank')
  expect(await open.getAttribute('rel')).toContain('noopener')
  expect(new URL((await open.getAttribute('href'))!).searchParams.get('q')).toBe(
    `Open the Lacuno editor on page p-home of site ${siteId} (${origin}/mcp/${siteId}).`,
  )
  const cta = canvas.locator('[data-lacuno-node="n-home-cta"]')
  await cta.waitFor()
  await cta.click()
  const label = (await canvas.locator('.bar-top .name').textContent())!
  await canvas.getByRole('button', { name: 'Ask AI', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: `Ask your AI about ${label}` })
  await dialog.waitFor()
  const prompt = dialog.getByLabel('Prompt', { exact: true })
  const text = await prompt.inputValue()
  expect(text).toContain(`on site ${siteId}, page p-home, element n-home-cta: fix what looks off`)
  expect(text).not.toContain('Test site')
  const query = async (name: string) => {
    const link = dialog.getByRole('link', { name, exact: true })
    const url = new URL((await link.getAttribute('href'))!)
    // The web links open beside the editor; the desktop app's scheme hands off from this tab.
    if (url.protocol === 'https:') {
      expect(await link.getAttribute('target')).toBe('_blank')
      expect(await link.getAttribute('rel')).toContain('noopener')
    } else expect(await link.getAttribute('target')).toBeNull()
    return url.searchParams.get('q')
  }
  const links = ['Open in claude.ai', 'Open in Claude Desktop', 'Open in ChatGPT']
  for (const name of links) expect(await query(name)).toBe(text)
  expect(
    await dialog.getByRole('link', { name: 'Open in Claude Desktop' }).getAttribute('href'),
  ).toMatch(/^claude:\/\/claude\.ai\/new\?q=/)
  await prompt.fill('Make the button green & round.')
  for (const name of links) expect(await query(name)).toBe('Make the button green & round.')
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

it('connects Claude first when no AI app is connected, except behind a gateway', async () => {
  const { context, page, siteId } = await editor()
  let connections: unknown[] = []
  let config = {}
  await page.route('**/api/sites/*/connections', (route) => route.fulfill({ json: connections }))
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...(await response.json()), ...config } })
  })
  await context.route('https://claude.ai/**', (route) => route.fulfill({ body: '' }))
  // Until the connections are read, the link opens the chat.
  const read = page.waitForResponse('**/api/sites/*/connections')
  await page.reload()
  await read
  const open = page.locator('.editor-header').getByRole('link', { name: 'Open in Claude' })
  const panel = page.getByRole('dialog', { name: 'Connect your AI' })
  // Nothing connected: the Connect panel opens with claude.ai chosen, and no chat.
  await open.click()
  await panel.waitFor()
  expect(await panel.getByRole('button', { name: 'claude.ai' }).getAttribute('aria-pressed')).toBe(
    'true',
  )
  expect(context.pages()).toHaveLength(1)
  // Connected: the chat opens.
  connections = [
    { id: 'c1', app: 'Claude', approvedAt: Date.now(), lastActiveAt: null, active: false },
  ]
  await page.reload()
  await expect.poll(() => page.locator('.connect-trigger').textContent()).toBe('Claude idle')
  const chat = context.waitForEvent('page')
  await open.click()
  expect(new URL((await chat).url()).hostname).toBe('claude.ai')
  expect(await panel.count()).toBe(0)
  // Behind a gateway an app connected at its one address lists nothing here: the chat opens, at
  // that address.
  connections = []
  config = { authentication: 'gateway', mcp: 'https://mcp.example.test/mcp' }
  await page.reload()
  await expect
    .poll(async () => new URL((await open.getAttribute('href'))!).searchParams.get('q'))
    .toBe(`Open the Lacuno editor on page p-home of site ${siteId} (https://mcp.example.test/mcp).`)
  const again = context.waitForEvent('page')
  await open.click()
  expect(new URL((await again).url()).hostname).toBe('claude.ai')
  expect(await panel.count()).toBe(0)
})
