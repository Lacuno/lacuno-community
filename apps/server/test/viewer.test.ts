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
const secret = 'viewer-test-gateway-key-of-32-characters'

it('opens the editor read-only for a viewer, whose writes the runtime refuses', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-viewer-'))
  let server: Awaited<ReturnType<typeof createServer>> | undefined
  let origin = ''
  /** Signs a request as the gateway does, for a user with `role` in the workspace "Studio". */
  const sign = (role: string, method: string, target: string, body: Uint8Array) => {
    const now = Math.floor(Date.now() / 1000)
    return new SignJWT({
      sub: `cloud-${role}`,
      name: `The ${role}`,
      email: `${role}@example.test`,
      jti: randomUUID(),
      iat: now,
      exp: now + 30,
      method,
      target,
      bodyHash: createHash('sha256').update(body).digest('hex'),
      role,
      workspace: 'Studio',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer)
      .setAudience(origin)
      .sign(new TextEncoder().encode(secret))
  }
  const forward = async (role: string, request: Request) => {
    const url = new URL(request.url)
    const target = url.pathname + url.search
    const body = new Uint8Array(await request.arrayBuffer())
    const headers = new Headers(request.headers)
    headers.set('x-lacuno-assertion', await sign(role, request.method, target, body))
    return server!.app.fetch(
      new Request(origin + target, {
        method: request.method,
        headers,
        ...(body.length ? { body } : {}),
      }),
    )
  }
  // A minimal gateway: every browser request is the viewer's.
  const gateway = serve({
    fetch: (request) => forward('viewer', request),
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
    secret: 'viewer-test-auth-secret-at-least-32-chars',
    templateDir: path.join(root, 'templates/lacuno'),
    editorDir: path.join(root, 'apps/editor/dist'),
    publishBaseURL: 'http://sites.localhost',
    gateway: { issuer, secret },
  })
  const created = await forward(
    'owner',
    new Request(`${origin}/api/sites`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Studio site' }),
    }),
  )
  const { id } = (await created.json()) as { id: string }

  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.setDefaultTimeout(8000)
  await page.goto(origin)
  // The workspace's own name, and nothing to create.
  await expect.poll(() => page.locator('.sites-main .eyebrow').textContent()).toBe('Studio')
  expect(await page.getByRole('button', { name: 'Create site' }).count()).toBe(0)

  await page.getByRole('button', { name: /Studio site/ }).click()
  const canvas = page.frameLocator('iframe[title="Site canvas"]')
  const heading = canvas.getByRole('heading').first()
  await heading.waitFor()
  await expect.poll(() => page.locator('.save-state').textContent()).toBe('View only')
  for (const control of [
    page.getByRole('button', { name: 'Publish', exact: true }),
    page.locator('.connect-trigger'),
  ])
    expect(await control.count()).toBe(0)
  expect(await page.getByRole('button', { name: 'Undo' }).isDisabled()).toBe(true)
  // Choosing or double-clicking an element opens no inspector and no text editor.
  await heading.click()
  await heading.dblclick()
  await page.waitForTimeout(300)
  expect(await page.locator('aside.inspector.page-inspector').count()).toBe(1)
  expect(await page.getByRole('button', { name: 'Page settings' }).isDisabled()).toBe(true)
  expect(await canvas.getByLabel('Canvas text editor').count()).toBe(0)

  // Writes sent straight to the API are refused, whatever the editor shows.
  const write = async (method: 'post' | 'delete', route: string, data: unknown = {}) =>
    (await page.request[method](origin + route, { data, headers: { origin } })).status()
  const document = (await (
    await page.request.get(`${origin}/api/sites/${id}/document`)
  ).json()) as {
    revision: number
  }
  for (const [method, route, data] of [
    [
      'post',
      `/api/sites/${id}/document/apply`,
      {
        expectedRevision: document.revision,
        operations: [{ type: 'site.update', name: 'Taken over' }],
      },
    ],
    ['post', `/api/sites/${id}/assets/upload`, { name: 'a.png', data: 'iVBORw0KGgo=' }],
    [
      'post',
      `/api/sites/${id}/releases`,
      { expectedRevision: document.revision, expectedId: null },
    ],
    ['post', '/api/sites', { name: 'Viewer site' }],
    ['delete', `/api/sites/${id}/connections/any`, undefined],
    ['post', '/api/auth/oauth2/consent', { accept: true, oauth_query: 'x=1' }],
  ] as const)
    expect(await write(method, route, data), route).toBe(403)
  expect((await page.request.get(`${origin}/api/auth/oauth2/authorize?client_id=x`)).status()).toBe(
    403,
  )
  const after = (await (await page.request.get(`${origin}/api/sites/${id}/document`)).json()) as {
    revision: number
  }
  expect(after.revision).toBe(document.revision)
})
