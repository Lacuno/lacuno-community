import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('previews the draft with its scripts, follows its links and keeps it from the editor', async () => {
  const { context, origin, siteId, document, page } = await editor()
  const response = await context.request.post(`${origin}/api/sites/${siteId}/document/apply`, {
    data: {
      expectedRevision: (await document()).revision,
      operations: [
        {
          type: 'site.update',
          // The site's code runs, but its frame cannot read the editor's API with the session.
          bodyCode:
            '<script>fetch("/api/sites", { credentials: "include" }).then((r) => r.status, () => "blocked").then((s) => { document.body.dataset.api = s })</script><a href="/team">Team link</a><form><button>Send</button></form>',
        },
        {
          type: 'page.create',
          id: 'p-team',
          name: 'Team',
          path: '/team',
          root: {
            id: 'n-team',
            type: 'element',
            tag: 'main',
            children: [
              {
                id: 'n-team-title',
                type: 'text',
                tag: 'h1',
                text: { type: 'static', value: 'Our team' },
              },
            ],
          },
        },
      ],
    },
  })
  expect(response.status(), await response.text()).toBe(200)
  await page.getByRole('button', { name: 'Preview site', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Preview' })
  const frame = page.frameLocator('iframe[title="Site preview"]')
  await expect.poll(() => frame.locator('body').getAttribute('data-api')).toBe('blocked')
  await expect.poll(() => dialog.locator('.site-preview-path').textContent()).toBe('/')

  await frame.getByRole('link', { name: 'Team link' }).click()
  await frame.getByRole('heading', { name: 'Our team' }).waitFor()
  expect(await dialog.locator('.site-preview-path').textContent()).toBe('/team')

  await frame.getByRole('button', { name: 'Send' }).click()
  await dialog.getByText('Forms are not sent in preview.').waitFor()

  await dialog.getByRole('button', { name: 'Mobile' }).click()
  expect(await page.locator('iframe[title="Site preview"]').evaluate((el) => el.clientWidth)).toBe(
    390,
  )
  await dialog.getByRole('button', { name: 'Close preview' }).click()
  await expect.poll(() => dialog.count()).toBe(0)
})
