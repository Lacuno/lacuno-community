import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { jwtVerify, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ServerOptions } from '../src/app.js'
import { openDatabase } from '../src/database.js'
import { withRetries } from '../src/export.js'

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
  const lists = new Map<string, string>()
  const activity: unknown[] = []
  const log: string[] = []
  let failures: { match: RegExp; status: number; times: number } | undefined
  let inflight = 0
  // Cloud's build slots: 202 while `full`, as when the server runs as many builds as it takes.
  let full = false
  let peak = 0
  const sink = createHttpServer(async (request, response) => {
    peak = Math.max(peak, ++inflight)
    response.on('finish', () => inflight--)
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
        (['HEAD', 'DELETE'].includes(request.method!) || payload.sha256 === sha256(body)),
      () => false,
    )
    log.push(`${request.method} ${key}`)
    if (!valid) return response.writeHead(401).end()
    if (failures?.match.test(`${request.method} ${key}`) && failures.times-- > 0)
      return response.writeHead(failures.status).end()
    if (key === 'build')
      return response.writeHead(request.method === 'PUT' && full ? 202 : 204).end()
    if (request.method === 'HEAD') return response.writeHead(files.has(key!) ? 200 : 404).end()
    if (key!.startsWith('pointer/')) pointers.set(key!.slice('pointer/'.length), body.toString())
    else if (key === 'assets') lists.set(siteId!, body.toString())
    else if (key === 'activity') activity.push(JSON.parse(body.toString()))
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
      // One AI app, connected by the gateway's user, for every site.
      oauth: {
        verify: async (authorization, siteId) =>
          authorization === 'Bearer agent-token'
            ? {
                userId: 'cloud-user-1',
                siteId,
                clientId: 'app-1',
                connectionId: 'conn-1',
                app: 'Test App',
                user: 'Gateway owner',
              }
            : null,
        connections: () => [],
        revoke: async () => {},
        touch: () => {},
      },
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
    'uploads a release before it goes live, a few files at a time, and skips immutable files the sink has',
    async () => {
      log.length = 0
      peak = 0
      second = await publish(first)
      expect(peak).toBeGreaterThan(1)
      expect(peak).toBeLessThanOrEqual(8)
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
    'retries an upload through a sink outage, and fails a refused one, activating nothing',
    async () => {
      // A Cloud redeploy: the sink answers 502 for a moment.
      log.length = 0
      failures = { match: /^PUT releases\/[^/]+\/index\.html$/, status: 502, times: 2 }
      second = await publish(second)
      expect(log.filter((line) => line === `PUT releases/${second}/index.html`)).toHaveLength(3)
      await expect.poll(() => pointers.get('production')).toBe(second)

      failures = { match: /^PUT releases\//, status: 400, times: 1 }
      const failed = await publish(second, 'failed')
      const row = (await history()).releases.find((release) => release.id === failed)
      expect(row?.error).toBe(
        'The site could not be copied to the edge, even after several tries. The live site is unchanged. Publish again to retry.',
      )
      expect((await history()).publishedId).toBe(second)
      expect(table('export_pointer')).toEqual([])
      expect(pointers.get('production')).toBe(second)
    },
    build,
  )

  it(
    'waits for a build slot, shown as waiting, and gives it back before the upload',
    async () => {
      log.length = 0
      full = true
      // A changed draft: a document built already is copied without a slot.
      const { revision } = await call(`/api/sites/${site}/document`)
      await call(`/api/sites/${site}/document/apply`, {
        expectedRevision: revision,
        operations: [{ type: 'site.update', name: 'Waited' }],
      })
      const { id } = await call(`/api/sites/${site}/releases`, {
        expectedRevision: revision + 1,
        expectedId: second,
      })
      const status = async () => (await history()).releases.find((row) => row.id === id)?.status
      await expect.poll(status).toBe('waiting')
      const busy = await (await server.app.request(`${origin}/health`)).json()
      expect(busy).toEqual({ status: 'ok', busy: true })
      await new Promise((resolve) => setTimeout(resolve, 1500))
      expect(await status()).toBe('waiting')
      expect(log.filter((line) => line === 'PUT build').length).toBeGreaterThan(1)
      full = false
      await expect.poll(status, { timeout: build }).toBe('ready')
      second = id
      expect(log.indexOf('DELETE build')).toBeGreaterThan(-1)
      expect(log.indexOf('DELETE build')).toBeLessThan(log.indexOf(`PUT releases/${id}/index.html`))

      // A Cloud without build slots refuses the key: the build starts at once.
      log.length = 0
      failures = { match: /^PUT build$/, status: 400, times: 1 }
      const { revision: next } = await call(`/api/sites/${site}/document`)
      await call(`/api/sites/${site}/document/apply`, {
        expectedRevision: next,
        operations: [{ type: 'site.update', name: 'Built at once' }],
      })
      second = await publish(second)
      expect(log.filter((line) => line.endsWith(' build'))).toEqual(['PUT build'])
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
  it('reports itself busy while a publication waits for the sink', async () => {
    const busy = async () =>
      (await (await server.app.request(`${origin}/health`)).json()).busy as boolean
    await expect.poll(busy).toBe(false)
    failures = { match: /^PUT pointer\/testing$/, status: 503, times: 1 }
    const { testingId } = await call(`/api/sites/${site}/releases`)
    await activate(testingId, testingId, 'testing')
    expect(await busy()).toBe(true)
    await expect.poll(busy, { timeout: 5000 }).toBe(false)
  })
  it('keeps a site’s newest thumbnail and sends it to the sink, failing until the sink has it', async () => {
    const created = await call('/api/sites', { name: 'Pictured' })
    const target = `/api/sites/${created.id}/thumbnail`
    const send = async (revision: number, image: Buffer) => {
      const body = JSON.stringify({ revision, image: image.toString('base64') })
      const response = await server.app.request(origin + target, {
        method: 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          'x-lacuno-assertion': await assertion(target, 'POST', body),
        },
        body,
      })
      return response.status
    }
    const webp = () =>
      Buffer.concat([Buffer.from('RIFF'), randomBytes(4), Buffer.from('WEBP'), randomBytes(32)])
    const drawn = webp()
    failures = { match: /^PUT thumbnail$/, status: 503, times: 1 }
    expect(await send(2, drawn)).toBe(502)
    expect(await send(2, drawn)).toBe(204)
    expect(files.get('thumbnail')?.equals(drawn)).toBe(true)
    // An editor that drew an older revision keeps nothing and sends nothing.
    expect(await send(1, webp())).toBe(204)
    expect(files.get('thumbnail')?.equals(drawn)).toBe(true)
    expect(await send(3, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe(400)
    const { sites } = await call('/api/sites')
    expect(sites.find((item: { id: string }) => item.id === created.id).thumbnail).toBe(2)
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

    // A workspace at its plan's storage limit gets its own answer.
    failures = { match: /^PUT asset\//, status: 507, times: 1 }
    const full = await server.app.request(origin + target, {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        'x-lacuno-assertion': await assertion(target, 'POST', body),
      },
      body,
    })
    expect(full.status).toBe(507)
    expect(await full.json()).toEqual({
      error:
        'Storage is full. This workspace has used all the storage in its plan. Delete files you no longer need or upgrade the plan.',
    })
  })

  it(
    'tells Cloud what an AI app did for whoever connected it; its files meet the storage limit',
    async () => {
      const client = new Client({ name: 'Claude Code', version: '1.0.0' })
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`${origin}/mcp/${site}`), {
          requestInit: { headers: { authorization: 'Bearer agent-token' } },
          fetch: async (url, init) => server.app.request(url, init),
        }) as Transport,
      )
      const tool = async (name: string, args: Record<string, unknown> = {}) =>
        JSON.parse(
          ((await client.callTool({ name, arguments: args })).content as { text: string }[])[0]!
            .text,
        )
      const { revision } = await tool('document.read')
      const operations = [{ type: 'class.create', name: 'agent' }]
      await tool('document.apply', { expectedRevision: revision, operations })
      await tool('document.apply', { expectedRevision: revision + 1, operations })
      // Edits count once an hour per session; a publish each time.
      await expect(tool('site.publish')).resolves.toHaveProperty('url')
      const by = { user: 'cloud-user-1', app: 'Claude Code' }
      await expect
        .poll(() => activity)
        .toEqual([
          { ...by, action: 'edited' },
          { ...by, action: 'published' },
        ])

      // A full workspace takes no new file from an AI app either.
      failures = { match: /^PUT asset\//, status: 507, times: 2 }
      const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(64)])
      expect(
        await tool('asset.import', { name: 'full.png', data: png.toString('base64') }),
      ).toEqual({
        kind: 'input',
        message: expect.stringContaining('Storage is full.'),
      })
      const { url } = await tool('asset.upload', { name: 'full.png' })
      const answer = await server.app.request(url, { method: 'PUT', body: new Uint8Array(png) })
      expect(answer.status).toBe(507)
      await client.close()
    },
    build,
  )

  it('sends a site’s asset list when a save changes it, retrying after a sink error', async () => {
    const created = await call('/api/sites', { name: 'Listed' })
    const listed = () => lists.get(created.id)?.split('\n')
    const apply = async (operations: unknown[]) => {
      const { revision } = await call(`/api/sites/${created.id}/document`)
      return call(`/api/sites/${created.id}/document/apply`, {
        expectedRevision: revision,
        operations,
      })
    }
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(64)])
    const upload = { name: 'listed.png', data: png.toString('base64') }
    const asset = await call(`/api/sites/${created.id}/assets/upload`, upload)
    failures = { match: /^PUT assets$/, status: 503, times: 1 }
    await apply([{ type: 'asset.create', ...asset }])
    await expect.poll(listed, { timeout: 5000 }).toContain(asset.hash)
    expect(log.filter((line) => line === 'PUT assets').length).toBeGreaterThanOrEqual(2)
    await expect.poll(() => table('export_assets')).toEqual([])

    // A deleted asset leaves the list; a save that keeps the assets sends none.
    await apply([{ type: 'asset.delete', id: asset.id }])
    await expect.poll(listed).not.toContain(asset.hash)
    log.length = 0
    await apply([{ type: 'site.update', name: 'Renamed' }])
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(log).toEqual([])
  })
})

describe('retries', () => {
  const answers = (...statuses: (number | undefined)[]) => {
    const calls = { count: 0 }
    const call = async () => {
      const status = statuses[calls.count++]
      if (status === undefined) throw new TypeError('fetch failed')
      return new Response(null, { status })
    }
    return { calls, call }
  }
  it('asks again after no answer, a 429 or a 5xx, and gives up after the last wait', async () => {
    const outage = answers(undefined, 502, 429, 503, 204)
    expect((await withRetries(outage.call, [1, 1, 1, 1]))?.status).toBe(204)
    expect(outage.calls.count).toBe(5)
    const down = answers(502, 502, 502)
    expect((await withRetries(down.call, [1, 1]))?.status).toBe(502)
    expect(down.calls.count).toBe(3)
    const gone = answers(undefined, undefined)
    expect(await withRetries(gone.call, [1])).toBeUndefined()
  })
  it('takes a refusal as the answer, and stops asking once stopped', async () => {
    const refused = answers(400, 204)
    expect((await withRetries(refused.call, [1]))?.status).toBe(400)
    expect(refused.calls.count).toBe(1)
    const stopping = answers(502, 204)
    expect((await withRetries(stopping.call, [1], () => true))?.status).toBe(502)
    expect(stopping.calls.count).toBe(1)
  })
})
