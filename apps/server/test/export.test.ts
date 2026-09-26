import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { jwtVerify, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ServerOptions } from '../src/app.js'
import { openDatabase } from '../src/database.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const issuer = 'http://cloud.localhost:4000'
const origin = 'http://runtime.editor.localhost:4000'
const secret = 'export-test-gateway-key-of-32-characters'
const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex')
const build = 60_000

describe('export to the edge', () => {
  let dir = ''
  let options: ServerOptions
  let server: Awaited<ReturnType<typeof createServer>>
  let site = ''
  // A fake Cloud sink: it checks every token like Cloud does and keeps what it was sent.
  const files = new Map<string, Buffer>()
  const pointers = new Map<string, string>()
  const log: string[] = []
  let failures: { match: RegExp; status: number; times: number } | undefined
  const sink = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const [, siteId, key] = /^\/export\/sites\/([^/]+)\/(.+)$/.exec(request.url!)!
    const valid = await jwtVerify(
      request.headers.authorization?.replace(/^Bearer /, '') ?? '',
      new TextEncoder().encode(secret),
      { algorithms: ['HS256'], issuer: origin, audience: 'lacuno-export', maxTokenAge: 60 },
    ).then(
      ({ payload }) =>
        payload.site === siteId &&
        payload.key === key &&
        payload.exp! - payload.iat! <= 60 &&
        (request.method === 'HEAD' || payload.sha256 === sha256(body)),
      () => false,
    )
    log.push(`${request.method} ${key}`)
    if (!valid) return response.writeHead(401).end()
    if (failures?.match.test(`${request.method} ${key}`) && failures.times-- > 0)
      return response.writeHead(failures.status).end()
    if (request.method === 'HEAD') return response.writeHead(files.has(key!) ? 200 : 404).end()
    if (key!.startsWith('pointer/')) pointers.set(key!.slice('pointer/'.length), body.toString())
    else files.set(key!, body)
    response.writeHead(204).end()
  })

  const assertion = (target: string, method: string, body: string) => {
    const now = Math.floor(Date.now() / 1000)
    return new SignJWT({
      sub: 'cloud-user-1',
      name: 'Gateway owner',
      email: 'owner@example.test',
      jti: randomUUID(),
      iat: now,
      exp: now + 30,
      method,
      target,
      bodyHash: sha256(body),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer)
      .setAudience(origin)
      .sign(new TextEncoder().encode(secret))
  }
  const call = async (target: string, data?: unknown) => {
    const method = data === undefined ? 'GET' : 'POST'
    const body = data === undefined ? '' : JSON.stringify(data)
    const response = await server.app.request(origin + target, {
      method,
      headers: {
        origin,
        'content-type': 'application/json',
        'x-lacuno-assertion': await assertion(target, method, body),
      },
      ...(body ? { body } : {}),
    })
    expect(response.status, await response.clone().text()).toBeLessThan(300)
    return response.json()
  }
  type History = {
    publishedId: string | null
    releases: { id: string; status: string; error: string | null }[]
  }
  const history = () => call(`/api/sites/${site}/releases`) as Promise<History>
  const publish = async (expectedId: string | null, status = 'ready') => {
    const { revision } = await call(`/api/sites/${site}/document`)
    const { id } = await call(`/api/sites/${site}/releases`, {
      expectedRevision: revision,
      expectedId,
    })
    await expect
      .poll(async () => (await history()).releases.find((row) => row.id === id)?.status, {
        timeout: build,
      })
      .toBe(status)
    return id as string
  }
  const activate = (id: string, expectedId: string | null, target = 'production') =>
    call(`/api/sites/${site}/releases/${id}/activate`, { expectedId, target })
  const table = (name: string) => {
    const { sqlite } = openDatabase(dir)
    try {
      return sqlite.prepare(`SELECT * FROM ${name}`).all()
    } finally {
      sqlite.close()
    }
  }

  beforeAll(async () => {
    sink.listen(0, '127.0.0.1')
    await once(sink, 'listening')
    dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-export-'))
    options = {
      dataDir: dir,
      baseURL: origin,
      publishBaseURL: 'http://sites.localhost',
      secret: 'export-test-auth-secret-at-least-32-chars',
      templateDir: path.join(root, 'templates/lacuno'),
      gateway: { issuer, secret },
    }
    server = await createServer(options)
    site = (await call('/api/sites', { name: 'Exported' })).id
  })
  afterAll(async () => {
    server.close()
    sink.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('requires the gateway settings', async () => {
    const { gateway: _, ...local } = options
    const other = await mkdtemp(path.join(os.tmpdir(), 'lacuno-export-local-'))
    try {
      await expect(
        createServer({ ...local, dataDir: other, export: 'http://127.0.0.1:1/export' }),
      ).rejects.toThrow('Export requires the gateway settings')
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  let first = ''
  it(
    'exports nothing without the setting, then backfills current releases once',
    async () => {
      first = await publish(null)
      expect(table('export_pointer')).toEqual([])
      expect(table('exported_release')).toEqual([])
      expect(log).toEqual([])

      server.close()
      options.export = `http://127.0.0.1:${(sink.address() as AddressInfo).port}/export`
      server = await createServer(options)
      await expect.poll(() => pointers.get('production'), { timeout: build }).toBe(first)
      const keys = [...files.keys()]
      expect(keys).toContain(`releases/${first}/index.html`)
      expect(keys).toContain(`releases/${first}/about/index.html`)
      expect(keys.some((key) => key.startsWith('immutable/_astro/'))).toBe(true)
      expect(
        keys.every((key) => key.startsWith(`releases/${first}/`) || key.startsWith('immutable/')),
      ).toBe(true)
      expect(files.get(`releases/${first}/lacuno.json`)).toBeUndefined()
      expect(table('exported_release')).toEqual([{ release_id: first }])
      await expect.poll(() => table('export_pointer')).toEqual([])

      server.close()
      log.length = 0
      server = await createServer(options)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(log).toEqual([])
    },
    build * 2,
  )

  let second = ''
  it(
    'uploads a release before it goes live and skips immutable files the sink has',
    async () => {
      log.length = 0
      second = await publish(first)
      const puts = log.filter((line) => line.startsWith('PUT '))
      expect(puts).toContain(`PUT releases/${second}/index.html`)
      expect(puts.filter((line) => line.startsWith('PUT immutable/'))).toEqual([])
      expect(log.some((line) => line.startsWith('HEAD immutable/_astro/'))).toBe(true)
      // The release files are all up before the pointer moves.
      await expect.poll(() => pointers.get('production')).toBe(second)
      expect(log.indexOf('PUT pointer/production')).toBeGreaterThan(
        log.lastIndexOf(`PUT releases/${second}/index.html`),
      )
    },
    build,
  )

  it(
    'fails the release when the upload fails and activates nothing',
    async () => {
      failures = { match: /^PUT releases\//, status: 502, times: 1 }
      const failed = await publish(second, 'failed')
      const row = (await history()).releases.find((release) => release.id === failed)
      expect(row?.error).toBe('Publishing to the edge failed. Publish again to retry.')
      expect((await history()).publishedId).toBe(second)
      expect(table('export_pointer')).toEqual([])
      expect(pointers.get('production')).toBe(second)
    },
    build,
  )

  it('sends pointers for rollback, send to testing and promote, retrying after a sink error', async () => {
    await activate(first, second)
    await expect.poll(() => pointers.get('production')).toBe(first)
    await activate(second, null, 'testing')
    await expect.poll(() => pointers.get('testing')).toBe(second)

    log.length = 0
    failures = { match: /^PUT pointer\/production$/, status: 503, times: 1 }
    await activate(second, first)
    await expect.poll(() => pointers.get('production')).toBe(second)
    expect(log.filter((line) => line === 'PUT pointer/production')).toHaveLength(2)
    await expect.poll(() => table('export_pointer')).toEqual([])
  })
  it('keeps template and uploaded assets in the sink before answering', async () => {
    const created = await call('/api/sites', { name: 'Assets' })
    const { document } = await call(`/api/sites/${created.id}/document`)
    const hashes = Object.values(document.assets as Record<string, { hash: string }>).map(
      (asset) => asset.hash,
    )
    expect(hashes.length).toBeGreaterThan(0)
    for (const hash of hashes) expect(files.get(`asset/${hash}`)).toBeDefined()

    // A PNG by its signature; the upload answers only once the sink has it.
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(64)])
    const upload = { name: 'photo.png', data: png.toString('base64') }
    const asset = await call(`/api/sites/${created.id}/assets/upload`, upload)
    expect(files.get(`asset/${asset.hash}`)?.equals(png)).toBe(true)

    // A sink failure fails the upload, so the editor never registers the asset.
    const other = Buffer.concat([png.subarray(0, 8), randomBytes(64)])
    failures = { match: /^PUT asset\//, status: 503, times: 1 }
    const target = `/api/sites/${created.id}/assets/upload`
    const body = JSON.stringify({ name: 'other.png', data: other.toString('base64') })
    const failed = await server.app.request(origin + target, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-lacuno-assertion': await assertion(target, 'POST', body),
      },
      body,
    })
    expect(failed.status).toBe(502)
    expect(await failed.json()).toEqual({
      error: 'The file could not be stored. Please try again.',
    })
    expect([...files.keys()].filter((key) => key.startsWith('asset/'))).toHaveLength(
      hashes.length + 1,
    )
  })
})
