import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashAsset, parseDocument } from '@freeflow/schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type ServerOptions } from '../src/app.js'

const origin = 'http://localhost:3000'
const password = 'a-unique-test-password-2026'
let options: ServerOptions
let server: Awaited<ReturnType<typeof createServer>>

function request(route: string, cookie = '', body?: unknown, headers: Record<string, string> = {}) {
  return server.app.request(`${origin}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin, 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function readDocument(route: string, cookie: string) {
  const response = await request(route, cookie)
  expect(response.status).toBe(200)
  const body = (await response.json()) as { document: unknown; revision: number }
  return { revision: body.revision, document: parseDocument(body.document) }
}

async function register(email = 'owner@example.test') {
  const response = await request('/api/auth/sign-up/email', '', { name: 'Owner', email, password })
  expect(response.status, await response.clone().text()).toBe(200)
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  expect(cookie).toContain('session_token')
  return cookie
}

async function createSite(cookie: string) {
  const response = await request('/api/sites', cookie, { name: 'My first site' })
  expect(response.status, await response.clone().text()).toBe(201)
  return (await response.json()) as { id: string; revision: number }
}

beforeEach(async () => {
  options = {
    dataDir: await mkdtemp(path.join(os.tmpdir(), 'freeflow-server-')),
    templateDir: fileURLToPath(new URL('../../../templates/freeflow', import.meta.url)),
    baseURL: origin,
    secret: 'test-only-secret-6ea8114c2a7b4e68ba29c69b',
    allowSignup: true,
  }
  server = await createServer(options)
})

afterEach(async () => {
  server.close()
  await rm(options.dataDir, { recursive: true, force: true })
})

describe('server foundation', () => {
  it('serves authenticated canvas previews and asset bytes only to the site owner', async () => {
    const owner = await register()
    const { id } = await createSite(owner)
    const { document, revision } = await readDocument(`/api/sites/${id}/document`, owner)
    const previewRoute = `/api/sites/${id}/preview?page=p-home`
    const preview = await request(previewRoute, owner)
    expect(preview.status).toBe(200)
    expect(await preview.json()).toMatchObject({
      revision,
      html: expect.stringContaining('data-freeflow-node="n-home-title"'),
    })
    expect((await request(`/api/sites/${id}/preview?page=missing`, owner)).status).toBe(404)
    expect((await request(`/api/sites/${id}/preview?page=p-article`, owner)).status).toBe(400)
    const asset = Object.values(document.assets)[0]!
    const assetRoute = `/api/sites/${id}/assets/${asset.hash}`
    const response = await request(assetRoute, owner)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(asset.mime)
    expect(await hashAsset(new Uint8Array(await response.arrayBuffer()))).toBe(asset.hash)
    const other = await register('preview-other@example.test')
    for (const route of [previewRoute, assetRoute]) {
      expect((await request(route)).status).toBe(401)
      expect((await request(route, other)).status).toBe(404)
    }
  })
  it('signs in, creates a template site, edits and retrieves it after restart', async () => {
    await register()
    const login = await request('/api/auth/sign-in/email', '', {
      email: 'owner@example.test',
      password,
    })
    expect(login.status).toBe(200)
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    const workspace = await (await request('/api/workspaces', cookie)).json()
    const site = await createSite(cookie)
    const route = `/api/sites/${site.id}/document`
    const initial = await readDocument(route, cookie)
    expect(initial.revision).toBe(0)
    expect(Object.keys(initial.document.pages)).toHaveLength(4)
    for (const asset of Object.values(initial.document.assets) as { hash: string }[]) {
      const bytes = await readFile(
        path.join(options.dataDir, 'sites', site.id, 'assets', asset.hash),
      )
      expect(await hashAsset(bytes)).toBe(asset.hash)
    }
    const edit = await request(`${route}/apply`, cookie, {
      expectedRevision: 0,
      operations: [{ type: 'site.update', name: 'Saved after restart' }],
    })
    expect(edit.status).toBe(200)
    expect(await edit.json()).toMatchObject({ revision: 1 })
    server.close()
    server = await createServer(options)
    const persisted = await readDocument(route, cookie)
    expect(persisted.document.site.name).toBe('Saved after restart')
    expect(persisted.revision).toBe(1)
    expect(await (await request('/api/workspaces', cookie)).json()).toEqual(workspace)
    expect(await (await request('/api/sites', cookie)).json()).toMatchObject({
      sites: [{ name: 'Saved after restart' }],
    })
    expect((await request('/api/auth/sign-out', cookie, {})).status).toBe(200)
    expect((await request(route, cookie)).status).toBe(401)
  })

  it('creates a site from a document with its asset bytes', async () => {
    const cookie = await register()
    const template = JSON.parse(
      await readFile(path.join(options.templateDir, 'freeflow.json'), 'utf8'),
    )
    const document = { ...template, revision: 7, site: { ...template.site, locale: 'de-AT' } }
    const [asset] = Object.values(template.assets) as { id: string; hash: string }[]
    const png = await readFile(path.join(options.templateDir, 'assets', asset!.hash))
    const assets = { [asset!.hash]: png.toString('base64') }
    const create = (body: object) => request('/api/sites', cookie, { name: 'Moved', ...body })

    const other = Buffer.from('not the image').toString('base64')
    const failures = [
      { document, assets: {} },
      { document, assets: { [asset!.hash]: other } },
      { document: { ...document, pages: 'none' }, assets },
      { document },
    ]
    for (const body of failures) expect((await create(body)).status).toBe(400)
    expect(await (await create({ document, assets: {} })).json()).toEqual({
      error: `Asset ${asset!.id} is missing or does not match its hash`,
    })
    expect(await (await request('/api/sites', cookie)).json()).toEqual({ sites: [] })
    expect(await readdir(path.join(options.dataDir, 'sites'))).toEqual([])

    const response = await create({ document, assets })
    expect(response.status).toBe(201)
    const { id } = await response.json()
    const created = await readDocument(`/api/sites/${id}/document`, cookie)
    expect(created.revision).toBe(0)
    expect(created.document.site).toEqual({ ...document.site, name: 'Moved' })
    const bytes = await request(`/api/sites/${id}/assets/${asset!.hash}`, cookie)
    expect(Buffer.from(await bytes.arrayBuffer())).toEqual(png)
  })

  it('rejects anonymous access and hides other users sites', async () => {
    expect((await request('/health')).status).toBe(200)
    expect((await request('/api/sites')).status).toBe(401)
    expect((await request('/api/sites', '', { name: 'Anonymous' })).status).toBe(401)
    const owner = await register()
    const { id } = await createSite(owner)
    const other = await register('other@example.test')
    expect(await (await request('/api/sites', other)).json()).toEqual({ sites: [] })
    expect((await request(`/api/sites/${id}/document`, other)).status).toBe(404)
    expect(
      (
        await request(`/api/sites/${id}/document/apply`, other, {
          expectedRevision: 0,
          operations: [{ type: 'site.update', name: 'Stolen' }],
        })
      ).status,
    ).toBe(404)
    expect((await request('/api/sites/../../document', owner)).status).toBe(404)
  })

  it('keeps dry runs and invalid batches atomic and rejects stale revisions', async () => {
    const cookie = await register()
    const { id } = await createSite(cookie)
    const route = `/api/sites/${id}/document`
    const batch = { expectedRevision: 0, operations: [{ type: 'site.update', name: 'New name' }] }
    const dry = await request(`${route}/apply`, cookie, { ...batch, dryRun: true })
    expect(dry.status).toBe(200)
    expect(await dry.json()).toMatchObject({ revision: 0 })
    expect((await readDocument(route, cookie)).document.site.name).toBe('My first site')
    const invalid = await request(`${route}/apply`, cookie, {
      ...batch,
      operations: [...batch.operations, { type: 'page.delete', id: 'page_missing' }],
    })
    expect(invalid.status).toBe(400)
    expect((await readDocument(route, cookie)).revision).toBe(0)
    expect((await readDocument(route, cookie)).document.site.name).toBe('My first site')
    expect((await request(`${route}/apply`, cookie, batch)).status).toBe(200)
    const stale = await request(`${route}/apply`, cookie, batch)
    expect(stale.status).toBe(409)
    expect(await stale.json()).toMatchObject({ currentRevision: 1 })
  })

  it('allows only one of two concurrent writes, including across server instances', async () => {
    const cookie = await register()
    const { id } = await createSite(cookie)
    const second = await createServer(options)
    try {
      const init = {
        method: 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: 0,
          operations: [{ type: 'site.update', name: 'Winner' }],
        }),
      }
      const route = `${origin}/api/sites/${id}/document/apply`
      const responses = await Promise.all([
        server.app.request(route, init),
        second.app.request(route, init),
      ])
      expect(responses.map((r) => r.status).sort()).toEqual([200, 409])
      expect((await readDocument(`/api/sites/${id}/document`, cookie)).revision).toBe(1)
    } finally {
      second.close()
    }
  })

  it('rejects cross-origin writes, malformed JSON, unknown operations and oversized bodies', async () => {
    const cookie = await register()
    expect(
      (await request('/api/sites', cookie, { name: 'CSRF' }, { origin: 'https://evil.example' }))
        .status,
    ).toBe(403)
    expect(
      (await request('/api/sites', cookie, { name: 'CSRF' }, { 'sec-fetch-site': 'cross-site' }))
        .status,
    ).toBe(403)
    expect(
      (await request('/api/sites', cookie, { name: 'CSRF' }, { 'content-type': 'text/plain' }))
        .status,
    ).toBe(415)
    expect((await request('/api/sites', cookie, { name: '   ' })).status).toBe(400)
    const malformed = await server.app.request(`${origin}/api/sites`, {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      body: '{',
    })
    expect(malformed.status).toBe(400)
    const { id } = await createSite(cookie)
    expect(
      (
        await request(`/api/sites/${id}/document/apply`, cookie, {
          expectedRevision: 0,
          operations: [{ type: 'invented.operation' }],
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await request(`/api/sites/${id}/document/apply`, cookie, {
          name: 'x'.repeat(2 * 1024 * 1024),
        })
      ).status,
    ).toBe(413)
    expect(
      (await request('/api/sites', cookie, { name: 'x'.repeat(90 * 1024 * 1024) })).status,
    ).toBe(413)
  })

  it('disables registration by default and rejects incorrect passwords', async () => {
    await register()
    expect(
      (
        await request('/api/auth/sign-in/email', '', {
          email: 'owner@example.test',
          password: 'wrong-password',
        })
      ).status,
    ).toBe(401)
    server.close()
    const { allowSignup: _, ...closedOptions } = options
    server = await createServer(closedOptions)
    expect(
      (
        await request('/api/auth/sign-up/email', '', {
          name: 'Other',
          email: 'new@example.test',
          password,
        })
      ).status,
    ).toBe(400)
    expect(
      (await request('/api/auth/sign-in/email', '', { email: 'owner@example.test', password }))
        .status,
    ).toBe(200)
  })
})

it('stages authenticated image uploads and serves only registered workspace assets', async () => {
  const cookie = await register()
  const site = await createSite(cookie)
  const route = `/api/sites/${site.id}/assets/upload`
  const data =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  expect((await request(route, '', { name: 'pixel.png', data })).status).toBe(401)
  expect(
    (
      await request(
        route,
        cookie,
        { name: 'pixel.png', data },
        { origin: 'https://elsewhere.test' },
      )
    ).status,
  ).toBe(403)
  const stranger = await register('stranger@example.test')
  expect((await request(route, stranger, { name: 'pixel.png', data })).status).toBe(404)
  expect(
    (
      await request(route, cookie, {
        name: 'fake.png',
        data: Buffer.from('<script>alert(1)</script>').toString('base64'),
      })
    ).status,
  ).toBe(415)
  const oversized = Buffer.alloc(10 * 1024 * 1024 + 1)
  Buffer.from(data, 'base64').copy(oversized)
  expect(
    (await request(route, cookie, { name: 'huge.png', data: oversized.toString('base64') })).status,
  ).toBe(413)
  const response = await request(route, cookie, { name: 'pixel.png', data })
  expect(response.status).toBe(200)
  const asset = await response.json()
  expect(asset.mime).toBe('image/png')
  const bytesRoute = `/api/sites/${site.id}/assets/${asset.hash}`
  expect((await request(bytesRoute, cookie)).status).toBe(404)
  const snapshot = await readDocument(`/api/sites/${site.id}/document`, cookie)
  expect(
    (
      await request(`/api/sites/${site.id}/document/apply`, cookie, {
        expectedRevision: snapshot.revision,
        operations: [{ type: 'asset.create', ...asset }],
      })
    ).status,
  ).toBe(200)
  const served = await request(bytesRoute, cookie)
  expect(Buffer.from(await served.arrayBuffer())).toEqual(Buffer.from(data, 'base64'))
  expect(served.headers.get('content-type')).toBe('image/png')
  expect((await request(bytesRoute, stranger)).status).toBe(404)
  expect((await (await request(route, cookie, { name: 'same.png', data })).json()).id).toBe(
    asset.id,
  )
})

it('stages MP4 and WebM uploads as videos', async () => {
  const cookie = await register()
  const site = await createSite(cookie)
  const route = `/api/sites/${site.id}/assets/upload`
  const upload = async (name: string, bytes: number[]) =>
    request(route, cookie, { name, data: Buffer.from(bytes).toString('base64') })
  const mp4 = await upload('clip.mp4', [0, 0, 0, 24, ...Buffer.from('ftypisom'), 0, 0, 2, 0])
  expect(await mp4.json()).toMatchObject({ kind: 'video', mime: 'video/mp4' })
  const webm = await upload('clip.webm', [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81])
  expect(await webm.json()).toMatchObject({ kind: 'video', mime: 'video/webm' })
  expect((await upload('fake.mp4', [...Buffer.from('<video>clip</video>')])).status).toBe(415)
  // AVIF, HEIC and MOV share the ftyp box but are not MP4.
  expect(
    (await upload('photo.avif', [0, 0, 0, 24, ...Buffer.from('ftypavif'), 0, 0, 0, 0])).status,
  ).toBe(415)
})

it('stages WOFF2, WOFF, TTF and OTF uploads as fonts, typed by their bytes', async () => {
  const cookie = await register()
  const site = await createSite(cookie)
  const route = `/api/sites/${site.id}/assets/upload`
  const upload = async (name: string, bytes: Buffer) =>
    request(route, cookie, {
      name,
      data: Buffer.concat([bytes, Buffer.alloc(8)]).toString('base64'),
    })
  for (const [name, head, mime] of [
    ['a.woff2', Buffer.from('wOF2'), 'font/woff2'],
    ['a.woff', Buffer.from('wOFF'), 'font/woff'],
    ['a.ttf', Buffer.from([0, 1, 0, 0]), 'font/ttf'],
    ['b.ttf', Buffer.from('true'), 'font/ttf'],
    ['a.otf', Buffer.from('OTTO'), 'font/otf'],
  ] as const)
    expect(await (await upload(name, head)).json()).toMatchObject({ kind: 'font', mime })
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  expect(await (await upload('renamed.woff2', png)).json()).toMatchObject({ kind: 'image' })
  expect((await upload('fake.woff2', Buffer.from('@font-face{}'))).status).toBe(415)
})
