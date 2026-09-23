import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('connects an AI app from the header panel and disconnects it', async () => {
  const { page, siteId } = await editor()
  // The connections API and the config's origin and local flag are mocked until the server has them.
  let connections: unknown[] = []
  const deleted: string[] = []
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      json: { ...(await response.json()), origin: 'http://localhost:3000', local: true },
    })
  })
  await page.route('**/api/sites/*/connections', (route) => route.fulfill({ json: connections }))
  await page.route('**/api/sites/*/connections/*', (route) => {
    const request = route.request()
    deleted.push(
      `${request.method()} ${new URL(request.url()).pathname} ${request.headers()['content-type']}`,
    )
    connections = []
    return route.fulfill({ status: 204 })
  })
  const trigger = page.locator('.connect-trigger')
  expect(await trigger.textContent()).toBe('Connect your AI')

  await trigger.click()
  const panel = page.getByRole('dialog', { name: 'Connect your AI' })
  await panel.getByText(`http://localhost:3000/mcp/${siteId}`, { exact: true }).waitFor()
  const cards = panel.locator('.connect-card')
  expect(await cards.count()).toBe(8)
  const card = (name: string) =>
    cards.filter({ has: page.getByRole('heading', { name, exact: true }) })
  for (const name of ['claude.ai', 'ChatGPT']) {
    expect(await card(name).getByRole('button', { name: 'Copy URL' }).isDisabled()).toBe(true)
    await card(name).getByText('Needs a public address. Works on Freeflow Cloud.').waitFor()
    expect(await card(name).getAttribute('aria-disabled')).toBe('true')
  }
  // Claude Desktop's connector runs from Anthropic's cloud; its local bridge works here.
  const desktop = card('Claude Desktop')
  expect(await desktop.getAttribute('aria-disabled')).toBe('false')
  expect(await desktop.getByRole('button', { name: 'Copy URL' }).isDisabled()).toBe(true)
  expect(await desktop.getByRole('button', { name: 'Copy bridge snippet' }).isDisabled()).toBe(
    false,
  )
  expect(await card('Claude Code').getByRole('button', { name: 'Copy command' }).isDisabled()).toBe(
    false,
  )

  await card('Claude Code').getByRole('button', { name: 'Copy command' }).click()
  await panel.getByText('Waiting for Claude Code…', { exact: false }).waitFor()
  connections = [
    { id: 'c1', app: 'Claude Code', approvedAt: Date.now(), lastActiveAt: null, active: true },
  ]
  await expect.poll(() => trigger.textContent()).toBe('Claude Code connected')
  expect(await panel.getByText('Waiting for Claude Code…', { exact: false }).count()).toBe(0)

  await panel.getByRole('button', { name: 'Disconnect Claude Code' }).click()
  await panel.getByRole('button', { name: 'Confirm disconnect' }).click()
  await expect
    .poll(() => deleted)
    .toEqual([`DELETE /api/sites/${siteId}/connections/c1 application/json`])
  await expect.poll(() => trigger.textContent()).toBe('Connect your AI')
})
