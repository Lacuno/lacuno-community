import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AssetRef } from '@lacuno/schema'
import sharp from 'sharp'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createServer } from '../src/app.js'

const origin = 'http://localhost:3000'
let dataDir = ''
let server: Awaited<ReturnType<typeof createServer>>
let cookie = ''
let siteId = ''
let revision = 0

const request = (route: string, body?: unknown) =>
  server.app.request(origin + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** Uploads and registers a file, as the editor does, and returns the asset. */
async function add(name: string, bytes: Buffer) {
  const upload = await request(`/api/sites/${siteId}/assets/upload`, {
    name,
    data: bytes.toString('base64'),
  })
  expect(upload.status).toBe(200)
  const asset = (await upload.json()) as AssetRef
  await apply({ type: 'asset.create', ...asset })
  return asset
}

async function apply(operation: Record<string, unknown>) {
  const response = await request(`/api/sites/${siteId}/document/apply`, {
    expectedRevision: revision++,
    operations: [operation],
  })
  expect(response.status, await response.clone().text()).toBe(200)
}

const image = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#36c' } })

const variant = (hash: string, width: number) =>
  path.join(dataDir, 'sites', siteId, 'cache', 'images', `${hash}-${width}.webp`)

const settings = () => ({
  dataDir,
  templateDir: fileURLToPath(new URL('../../../templates/lacuno', import.meta.url)),
  baseURL: origin,
  secret: 'test-only-secret-6ea8114c2a7b4e68ba29c69b',
  allowSignup: true,
})

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-images-'))
  server = await createServer(settings())
  const signup = await request('/api/auth/sign-up/email', {
    name: 'Owner',
    email: 'owner@example.test',
    password: 'pw-2026-abcdef',
  })
  cookie = signup.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
  const site = await request('/api/sites', { name: 'Acme' })
  siteId = ((await site.json()) as { id: string }).id
  revision = 0
})

afterEach(async () => {
  server.close()
  await rm(dataDir, { recursive: true, force: true })
})

it('measures uploaded images, serves them resized to a listed width once, and never larger', async () => {
  const jpeg = await image(1000, 500).jpeg().toBuffer()
  const asset = await add('photo.jpg', jpeg)
  expect(asset).toMatchObject({ mime: 'image/jpeg', width: 1000, height: 500 })
  // A phone photo stored on its side is measured as it displays.
  const rotated = await image(1000, 500).jpeg().withMetadata({ orientation: 6 }).toBuffer()
  expect(await add('rotated.jpg', rotated)).toMatchObject({ width: 500, height: 1000 })

  // The widths the editor asks for first are resized in the background; the rest on demand.
  await expect
    .poll(() => existsSync(variant(asset.hash, 320)) && existsSync(variant(asset.hash, 960)))
    .toBe(true)
  const route = `/api/sites/${siteId}/assets/${asset.hash}`
  const resized = await request(`${route}?w=640`)
  expect(resized.status).toBe(200)
  expect(resized.headers.get('content-type')).toBe('image/webp')
  expect(resized.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
  const bytes = Buffer.from(await resized.arrayBuffer())
  expect(await sharp(bytes).metadata()).toMatchObject({ format: 'webp', width: 640, height: 320 })
  expect(await readFile(variant(asset.hash, 640))).toEqual(bytes)
  // The second request reads the file, not the image.
  await writeFile(variant(asset.hash, 640), 'kept')
  expect(await (await request(`${route}?w=640`)).text()).toBe('kept')

  const larger = await request(`${route}?w=1280`)
  expect(larger.headers.get('content-type')).toBe('image/jpeg')
  expect(Buffer.from(await larger.arrayBuffer())).toEqual(jpeg)
  expect(existsSync(variant(asset.hash, 1280))).toBe(false)
  const original = await request(route)
  expect(original.headers.get('content-type')).toBe('image/jpeg')
  expect(original.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
  for (const width of ['500', 'abc', ''])
    expect((await request(`${route}?w=${width}`)).status).toBe(400)

  await apply({ type: 'asset.delete', id: asset.id })
  expect(existsSync(variant(asset.hash, 640))).toBe(false)
})

it('serves a GIF as it is', async () => {
  const gif = await image(400, 200).gif().toBuffer()
  const asset = await add('loop.gif', gif)
  expect(asset).toMatchObject({ mime: 'image/gif', width: 400, height: 200 })
  const response = await request(`/api/sites/${siteId}/assets/${asset.hash}?w=320`)
  expect(response.headers.get('content-type')).toBe('image/gif')
  expect(Buffer.from(await response.arrayBuffer())).toEqual(gif)
})

it('measures images registered without a size when it starts', async () => {
  const upload = await request(`/api/sites/${siteId}/assets/upload`, {
    name: 'old.jpg',
    data: (await image(800, 600).jpeg().toBuffer()).toString('base64'),
  })
  // Registered the way an app did before the server measured: no size.
  const { width: _w, height: _h, ...unmeasured } = (await upload.json()) as AssetRef
  await apply({ type: 'asset.create', ...unmeasured })
  server.close()
  server = await createServer(settings())
  const measured = async () =>
    (
      (await (await request(`/api/sites/${siteId}/document`)).json()) as {
        document: { assets: Record<string, AssetRef> }
      }
    ).document.assets[unmeasured.id]
  await expect.poll(measured, { timeout: 10_000 }).toMatchObject({ width: 800, height: 600 })
  const thumb = await request(`/api/sites/${siteId}/assets/${unmeasured.hash}?w=320`)
  expect(thumb.headers.get('content-type')).toBe('image/webp')
})
