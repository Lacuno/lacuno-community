import path from 'node:path'
import { expect, it } from 'vitest'
import { editor, root } from './harness.js'

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
  // Nothing is chosen yet: the address is there for any other client, and no instructions show.
  await panel.getByText(`http://localhost:3000/mcp/${siteId}`, { exact: true }).waitFor()
  const apps = panel.locator('.connect-app')
  expect(await apps.count()).toBe(8)
  const card = panel.locator('.connect-card')
  expect(await card.count()).toBe(0)
  const choose = async (name: string) => {
    await apps.filter({ hasText: name }).click()
    await card.waitFor()
  }
  for (const name of ['claude.ai', 'ChatGPT']) {
    await choose(name)
    expect(await card.getByRole('button', { name: 'Copy URL' }).isDisabled()).toBe(true)
    await card.getByText('Needs a public address. Works on Lacuno Cloud.').waitFor()
  }
  // Claude Desktop's connector runs from Anthropic's cloud; its local bridge works here.
  await choose('Claude Desktop')
  expect(await card.getByRole('button', { name: 'Copy URL' }).isDisabled()).toBe(true)
  expect(await card.getByRole('button', { name: 'Copy bridge snippet' }).isDisabled()).toBe(false)
  await choose('Claude Code')
  expect(await card.count()).toBe(1)
  expect(await card.getByRole('button', { name: 'Copy command' }).isDisabled()).toBe(false)

  await card.getByRole('button', { name: 'Copy command' }).click()
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

it('offers a gateway’s one address for all sites first, above the site’s own', async () => {
  const { page, siteId } = await editor()
  const mcp = 'https://mcp.example.test/mcp'
  const prompt = 'Set up Lacuno by following the guide at https://lacuno.io/install.md'
  // A gateway's address is public, as a Cloud config reports.
  await page.route('**/api/config', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      json: { ...(await response.json()), home: 'https://app.example.test', mcp, local: false },
    })
  })
  await page.reload()
  await page.locator('.connect-trigger').click()
  const panel = page.getByRole('dialog', { name: 'Connect your AI' })
  const card = panel.locator('.connect-plugin')
  // One line for an AI app with a terminal, the address for the others, and no commands to run.
  await card.getByText(prompt, { exact: true }).waitFor()
  await card.getByRole('button', { name: 'Copy prompt' }).waitFor()
  expect(await card.locator('pre').count()).toBe(0)
  await card.getByText(mcp, { exact: true }).waitFor()
  expect(await card.getByRole('link', { name: 'account settings' }).getAttribute('href')).toBe(
    'https://app.example.test',
  )
  // The apps take the one address too; Claude Desktop needs no bridge to reach it.
  const apps = panel.locator('.connect-app')
  const steps = panel.locator('.connect-card:not(.connect-plugin)')
  await apps.filter({ hasText: 'Claude Code' }).click()
  await steps.getByText(`claude mcp add --transport http lacuno ${mcp}`, { exact: true }).waitFor()
  await apps.filter({ hasText: 'Claude Desktop' }).click()
  await steps.getByText(mcp, { exact: true }).waitFor()
  expect(await steps.getByRole('button', { name: 'Copy bridge snippet' }).count()).toBe(0)
  // The site's own address stays for any other client.
  await apps.filter({ hasText: 'Claude Desktop' }).click()
  await panel.getByText(`/mcp/${siteId}`, { exact: false }).waitFor()
  await panel.screenshot({ path: path.join(root, '.lacuno/editor-preview/connect-plugin.png') })
})
