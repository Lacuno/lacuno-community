import { expect, it } from 'vitest'
import { account, launch } from './harness.js'

it('starts a blank site from the site list', async () => {
  const { context, origin, page, server } = await launch()
  await page.goto(origin)
  await page.getByRole('button', { name: 'New here? Create an account' }).click()
  await page.getByLabel('Your name').fill('Tester')
  await page.getByLabel('Email', { exact: true }).fill(account.email)
  await page.getByLabel('Password', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByLabel('Site name').fill('Empty site')
  await expect.poll(() => page.getByLabel('Starter').isChecked()).toBe(true)
  await page.getByLabel('Blank').check()
  await page.getByRole('button', { name: 'Create site', exact: false }).click()
  const canvas = page.frameLocator('iframe[title="Site canvas"]')
  await canvas.locator('#lacuno-selection-overlay').waitFor({ state: 'attached' })
  const cookie = (await context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ')
  const site = new URL(page.url()).searchParams.get('site')
  const answer = await server.app.request(`${origin}/api/sites/${site}/document`, {
    headers: { cookie },
  })
  const { document } = (await answer.json()) as { document: { nodes: object } }
  expect(Object.keys(document.nodes)).toHaveLength(1)
})
