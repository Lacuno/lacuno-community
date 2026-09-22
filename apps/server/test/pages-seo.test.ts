import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer as tcpServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { createServer } from '../src/app.js'

it('sets site and page SEO in the editor and publishes it with a not-found page and a redirect', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-pages-seo-'))
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const reservation = tcpServer().listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const address = reservation.address()
  if (!address || typeof address === 'string') throw new Error('No port available')
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const origin = `http://127.0.0.1:${address.port}`
  const server = await createServer({
    dataDir: dir,
    templateDir: path.join(root, 'templates/freeflow'),
    editorDir: path.join(root, 'apps/editor/dist'),
    baseURL: origin,
    publishBaseURL: 'http://localhost:3103',
    secret: 'pages-seo-test-5c92df18eb07a3c46f9d21',
    allowSignup: true,
  })
  const listener = serve({ fetch: server.app.fetch, port: address.port, hostname: '127.0.0.1' })
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
    const page = await context.newPage()
    page.setDefaultTimeout(8000)
    const saved = () =>
      expect
        .poll(() => page.locator('.save-state').textContent(), { timeout: 8000 })
        .toBe('All changes saved')
    await page.goto(origin)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Your name').fill('SEO test')
    await page.getByLabel('Email', { exact: true }).fill('seo@example.test')
    await page.getByLabel('Password', { exact: true }).fill('seo-test-password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByLabel('Site name').fill('Pages and SEO')
    await page.getByRole('button', { name: 'Create site', exact: false }).click()
    await page
      .frameLocator('iframe[title="Site canvas"]')
      .locator('[data-freeflow-node]')
      .first()
      .waitFor()
    const image = 'freeflow-about-page-preview.png'

    // Site settings save each field as it is left.
    await page.getByRole('button', { name: 'Pages', exact: true }).click()
    await page.getByRole('button', { name: 'Site settings', exact: true }).click()
    const site = page.getByRole('dialog', { name: 'Site settings' })
    const url = site.getByLabel('Public URL', { exact: true })
    await url.fill('https://example.com/')
    await url.press('Tab')
    await site.getByText('without a trailing slash').waitFor()
    await url.fill('https://example.com')
    await url.press('Tab')
    await saved()
    await site.getByRole('button', { name: 'Choose favicon', exact: true }).click()
    await page.getByRole('button', { name: `Choose ${image}`, exact: true }).click()
    await saved()
    await expect.poll(() => site.locator('.image-choice strong').textContent()).toBe(image)
    const headCode = site.getByLabel('Head code', { exact: true })
    await headCode.fill('<meta name="site-marker" content="site">')
    await headCode.press('Tab')
    await saved()
    await site.getByLabel('Redirect from', { exact: true }).fill('/old')
    await site.getByLabel('Redirect to', { exact: true }).fill('/old')
    await site.getByRole('button', { name: 'Add', exact: true }).click()
    await site.getByText('cannot redirect to itself').waitFor()
    await site.getByLabel('Redirect to', { exact: true }).fill('/about')
    await site.getByRole('button', { name: 'Add', exact: true }).click()
    await saved()
    await site.getByText('/old → /about · 301').waitFor()
    await site.getByRole('button', { name: 'Close', exact: true }).click()

    // Page settings carry the rest of the page's SEO and its code.
    await page.getByRole('button', { name: 'Settings for About', exact: true }).click()
    const settings = page.getByRole('dialog', { name: 'Page settings' })
    await settings.getByLabel('SEO description', { exact: true }).fill('About this site.')
    await settings.getByLabel('Hide from search engines', { exact: true }).check()
    await settings.getByRole('button', { name: 'Choose social image', exact: true }).click()
    await page.getByRole('button', { name: `Choose ${image}`, exact: true }).click()
    await settings
      .getByLabel('Head code', { exact: true })
      .fill('<meta name="page-marker" content="about">')
    await settings.getByRole('button', { name: 'Save page', exact: true }).click()
    await saved()

    // The not-found page is one checkbox away and marked in the list.
    await page.getByRole('button', { name: 'New page', exact: true }).click()
    const create = page.getByRole('dialog', { name: 'New page' })
    await create.getByLabel('Not found page', { exact: true }).check()
    expect(await create.getByLabel('URL path', { exact: true }).inputValue()).toBe('/404')
    await create.getByText('Served for unknown addresses').waitFor()
    await create.getByRole('button', { name: 'Create page', exact: true }).click()
    // Creating a page opens it, so the list's active page is the signal, not the save state.
    const active = page.locator('.page-link.active')
    await expect.poll(() => active.textContent()).toContain('Not found')
    await active.locator('.badge').waitFor()
    await page.getByRole('button', { name: 'New page', exact: true }).click()
    expect(await create.getByLabel('Not found page', { exact: true }).isDisabled()).toBe(true)
    await create.getByRole('button', { name: 'Close', exact: true }).click()

    const cookie = (await context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ')
    const api = (route: string, body?: unknown) =>
      server.app.request(origin + route, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    const { id, revision } = (
      (await (await api('/api/sites')).json()) as { sites: { id: string; revision: number }[] }
    ).sites[0]!
    type History = { publishedId: string | null; url: string }
    const history = async () => (await (await api(`/api/sites/${id}/releases`)).json()) as History
    const release = (await (
      await api(`/api/sites/${id}/releases`, { expectedRevision: revision, publishedId: null })
    ).json()) as { id: string }
    await expect
      .poll(async () => (await history()).publishedId, { timeout: 60_000 })
      .toBe(release.id)
    // Pages are served from the server's published address; the Public URL names them.
    const live = (await history()).url
    const publicUrl = 'https://example.com'
    const fetch = async (route: string) => await server.published!.request(`${live}${route}`)
    const text = async (route: string) => await (await fetch(route)).text()

    const about = await text('/about')
    expect(about).toContain(`<link rel="canonical" href="${publicUrl}/about">`)
    expect(about).toContain('<meta name="robots" content="noindex">')
    expect(about).toContain('<meta name="description" content="About this site.">')
    expect(about).toMatch(new RegExp(`<meta property="og:image" content="${publicUrl}/[^"]+">`))
    expect(about).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(about).toContain('<meta property="og:locale" content="en-US">')
    expect(about).toContain('<link rel="icon" type="image/png"')
    expect(about).toContain('<meta name="site-marker" content="site">')
    expect(about).toContain('<meta name="page-marker" content="about">')
    expect(await text('/')).toContain('<meta name="twitter:card" content="summary">')

    expect(await text('/404.html')).toContain('<title>Not found</title>')
    const sitemap = await text('/sitemap-0.xml')
    expect(sitemap).toContain(`<loc>${publicUrl}/</loc>`)
    expect(sitemap).not.toContain('/about')
    expect(sitemap).not.toContain('/404')
    expect(await text('/robots.txt')).toContain(`Sitemap: ${publicUrl}/sitemap-index.xml`)
    expect(await text('/old')).toMatch(/http-equiv="refresh" content="0;url=\/about"/)
  } finally {
    await browser.close()
    await new Promise<void>((resolve) => listener.close(() => resolve()))
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 240_000)
