import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { SignJWT } from 'jose'
import { chromium } from 'playwright'
import { expect, it, onTestFinished } from 'vitest'
import { createServer } from '../src/app.js'
import { root } from './harness.js'

const issuer = 'http://cloud.localhost:4000'
const secret = 'brand-test-gateway-key-of-32-characters'
const logo = 'http://brand.localhost/logo.svg'

it('shows the brand instead of Lacuno, with no AI apps, to an editor who may publish', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-brand-'))
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  let origin = ''
  /** Every request is the owner's when creating the site, then an editor's who may publish. */
  const forward = async (role: string, request: Request) => {
    const url = new URL(request.url)
    const target = url.pathname + url.search
    const body = new Uint8Array(await request.arrayBuffer())
    const now = Math.floor(Date.now() / 1000)
    const assertion = await new SignJWT({
      sub: `cloud-${role}`,
      name: `The ${role}`,
      email: `${role}@example.test`,
      jti: randomUUID(),
      iat: now,
      exp: now + 30,
      method: request.method,
      target,
      bodyHash: createHash('sha256').update(body).digest('hex'),
      role,
      ...(role === 'editor' ? { publish: true } : {}),
      workspace: 'Bakery',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer)
      .setAudience(origin)
      .sign(new TextEncoder().encode(secret))
    const headers = new Headers(request.headers)
    headers.set('x-lacuno-assertion', assertion)
    return server!.app.fetch(
      new Request(origin + target, {
        method: request.method,
        headers,
        ...(body.length ? { body } : {}),
      }),
    )
  }
  const gateway = serve({
    fetch: (request) => forward('editor', request),
    port: 0,
    hostname: '127.0.0.1',
  })
  const browser = await chromium.launch({ headless: true })
  onTestFinished(async () => {
    await browser.close()
    await new Promise<void>((resolve) => gateway.close(() => resolve()))
    server?.close()
    await rm(dir, { recursive: true, force: true })
  })
  if (!gateway.listening) await once(gateway, 'listening')
  origin = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`
  server = await createServer({
    dataDir: dir,
    baseURL: origin,
    secret: 'brand-test-auth-secret-at-least-32-chars',
    templateDir: path.join(root, 'templates/lacuno'),
    editorDir: path.join(root, 'apps/editor/dist'),
    publishBaseURL: 'http://sites.localhost',
    gateway: {
      issuer,
      secret,
      brand: { name: 'Studio Nord', logo, icon: 'http://brand.localhost/favicon.svg' },
    },
  })
  const created = await forward(
    'owner',
    new Request(`${origin}/api/sites`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bakery site' }),
    }),
  )
  const { id } = (await created.json()) as { id: string }

  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.setDefaultTimeout(8000)
  await page.route(`${issuer}/**`, (route) => route.fulfill({ body: 'Dashboard' }))
  await page.route('http://brand.localhost/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="30"/>',
    }),
  )
  await page.goto(`${origin}/?site=${id}`)
  const canvas = page.frameLocator('iframe[title="Site canvas"]')
  const heading = canvas.getByRole('heading').first()
  await heading.waitFor()
  const header = page.locator('.editor-header')
  await header.getByRole('img', { name: 'Studio Nord' }).waitFor()
  expect(await header.getByRole('img', { name: 'Studio Nord' }).getAttribute('src')).toBe(logo)
  expect(await header.textContent()).not.toContain('Lacuno')
  expect(await page.title()).toBe('Studio Nord — Editor')
  expect(await page.locator('link[rel="icon"]').getAttribute('href')).toBe(
    'http://brand.localhost/favicon.svg',
  )
  expect(await page.getByRole('button', { name: 'Publish', exact: true }).isVisible()).toBe(true)
  for (const control of [page.locator('.connect-trigger'), page.locator('.open-claude')])
    expect(await control.count()).toBe(0)
  // Selecting an element offers the canvas chips, but no Ask AI. The canvas takes clicks once its
  // load, after its images, installed the selection overlay.
  await canvas.locator('#lacuno-selection-overlay').waitFor({ state: 'attached' })
  await heading.click()
  await canvas.getByRole('button', { name: 'Spacing', exact: true }).waitFor()
  expect(await canvas.getByRole('button', { name: 'Ask AI', exact: true }).isVisible()).toBe(false)
})
