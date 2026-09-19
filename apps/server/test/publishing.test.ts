import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { createServer, type ServerOptions } from '../src/app.js'
import { openDatabase } from '../src/database.js'

const origin = 'http://localhost:3000'
type History = {
  publishedId: string | null
  url: string
  releases: {
    id: string
    revision: number
    version: number
    status: string
    error: string | null
  }[]
}

it('publishes pinned snapshots, isolates drafts, preserves live output on failure, and rolls back across restarts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-publish-'))
  const options: ServerOptions = {
    dataDir: dir,
    templateDir: fileURLToPath(new URL('../../../templates/freeflow', import.meta.url)),
    baseURL: origin,
    publishBaseURL: 'http://localhost:3001',
    secret: 'publishing-test-secret-192836519283651928365',
    allowSignup: true,
  }
  let server = await createServer(options)
  const request = (route: string, cookie = '', body?: unknown, requestOrigin = origin) =>
    server.app.request(origin + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, origin: requestOrigin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const register = async (email: string) => {
    const response = await request('/api/auth/sign-up/email', '', {
      name: 'Publisher',
      email,
      password: 'publishing-test-password',
    })
    expect(response.status).toBe(200)
    return response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
  }
  try {
    const cookie = await register('publisher@example.test')
    const created = await request('/api/sites', cookie, { name: 'Release test' })
    const { id } = (await created.json()) as { id: string }
    // A well-edited draft still starts its independent publishing history at v1.
    const seed = openDatabase(dir)
    seed.sqlite
      .prepare(
        "UPDATE sites SET revision=160, document=json_set(document, '$.revision', 160) WHERE id=?",
      )
      .run(id)
    seed.sqlite.close()
    const route = `/api/sites/${id}`
    const history = async () =>
      (await (await request(`${route}/releases`, cookie)).json()) as History
    const waitFor = async (releaseId: string, status: string) =>
      expect
        .poll(async () => (await history()).releases.find((row) => row.id === releaseId)?.status, {
          timeout: 20000,
        })
        .toBe(status)
    expect((await request(`${route}/releases`)).status).toBe(401)
    const other = await register('other-publisher@example.test')
    expect((await request(`${route}/releases`, other)).status).toBe(404)
    expect((await request(`${route}/releases`, cookie, { expectedRevision: 0 })).status).toBe(400)
    expect(
      (await request(`${route}/releases`, other, { expectedRevision: 0, publishedId: null }))
        .status,
    ).toBe(404)
    expect(
      (await request(`${route}/releases`, cookie, { expectedRevision: 1, publishedId: null }))
        .status,
    ).toBe(409)
    const first = await request(`${route}/releases`, cookie, {
      expectedRevision: 160,
      publishedId: null,
    })
    expect(first.status).toBe(202)
    const firstId = ((await first.json()) as { id: string }).id
    expect(
      (await request(`${route}/releases`, cookie, { expectedRevision: 0, publishedId: null }))
        .status,
    ).toBe(409)
    expect(
      (
        await request(`${route}/document/apply`, cookie, {
          expectedRevision: 160,
          operations: [
            {
              type: 'node.update',
              id: 'n-home-title',
              text: { type: 'static', value: 'An unpublished draft' },
            },
          ],
        })
      ).status,
    ).toBe(200)
    await waitFor(firstId, 'ready')
    expect((await history()).releases[0]).toMatchObject({ version: 1, revision: 160 })
    const liveURL = (await history()).url
    let published = await server.published!.request(`${liveURL}/`)
    expect(published.status).toBe(200)
    expect(published.headers.get('x-freeflow-release')).toBe(firstId)
    const originalHtml = await published.text()
    expect(originalHtml).not.toContain('An unpublished draft')
    expect((await server.published!.request(`${liveURL}/about`)).status).toBe(200)
    expect((await server.published!.request(`${liveURL}/freeflow.json`)).status).toBe(404)
    for (const suffix of [
      '/assets/%2e%2e%2ffreeflow.json',
      '/%ZZ',
      '/.cache/astro.config.mjs',
      '/assets/%5c..%5cfreeflow.json',
    ])
      expect((await server.published!.request(liveURL + suffix)).status).toBe(404)
    await symlink(
      path.join(dir, 'freeflow.sqlite'),
      path.join(dir, 'builds', id, firstId, 'dist', 'private.sqlite'),
    )
    expect((await server.published!.request(`${liveURL}/private.sqlite`)).status).toBe(404)
    const head = await server.published!.request(`${liveURL}/`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect((await server.published!.request(`${liveURL}/api/sites`)).status).toBe(404)
    expect((await server.published!.request('http://localhost:3001/')).status).toBe(404)
    expect(
      (
        await request(
          `${route}/releases`,
          cookie,
          { expectedRevision: 161, publishedId: firstId },
          liveURL,
        )
      ).status,
    ).toBe(403)
    const assetPath = originalHtml.match(/(?:src|href)="(\/(?:_astro|assets)\/[^" ]+)"/)?.[1]
    expect(assetPath).toBeTruthy()
    expect(
      (await server.published!.request(liveURL + assetPath)).headers.get('cache-control'),
    ).toContain('immutable')
    const second = await request(`${route}/releases`, cookie, {
      expectedRevision: 161,
      publishedId: firstId,
    })
    const secondId = ((await second.json()) as { id: string }).id
    await waitFor(secondId, 'ready')
    expect((await history()).releases[0]).toMatchObject({ version: 2, revision: 161 })
    published = await server.published!.request(`${liveURL}/`)
    expect(await published.text()).toContain('An unpublished draft')
    expect(
      (
        await request(`${route}/document/apply`, cookie, {
          expectedRevision: 161,
          operations: [
            {
              type: 'asset.create',
              id: 'a-missing',
              name: 'Missing image',
              kind: 'image',
              hash: 'a'.repeat(64),
              mime: 'image/png',
              size: 10,
            },
          ],
        })
      ).status,
    ).toBe(200)
    const broken = await request(`${route}/releases`, cookie, {
      expectedRevision: 162,
      publishedId: secondId,
    })
    const brokenId = ((await broken.json()) as { id: string }).id
    await waitFor(brokenId, 'failed')
    expect((await history()).releases[0]).toMatchObject({ version: 3, revision: 162 })
    expect((await history()).publishedId).toBe(secondId)
    expect(await (await server.published!.request(`${liveURL}/`)).text()).toContain(
      'An unpublished draft',
    )
    const anotherSite = (await (
      await request('/api/sites', cookie, { name: 'Another site' })
    ).json()) as { id: string }
    expect(
      (
        await request(`/api/sites/${anotherSite.id}/releases/${firstId}/activate`, cookie, {
          publishedId: null,
        })
      ).status,
    ).toBe(404)
    expect(
      (await request(`${route}/releases/${brokenId}/activate`, cookie, { publishedId: secondId }))
        .status,
    ).toBe(404)
    expect(
      (await request(`${route}/releases/${firstId}/activate`, other, { publishedId: secondId }))
        .status,
    ).toBe(404)
    expect(
      (await request(`${route}/releases/${firstId}/activate`, cookie, { publishedId: secondId }))
        .status,
    ).toBe(200)
    expect(
      (await request(`${route}/releases/${secondId}/activate`, cookie, { publishedId: secondId }))
        .status,
    ).toBe(409)
    const draft = (await (await request(`${route}/document`, cookie)).json()) as {
      revision: number
    }
    expect(draft.revision).toBe(162)
    server.close()
    server = await createServer(options)
    expect((await history()).releases).toHaveLength(3)
    expect((await history()).publishedId).toBe(firstId)
    expect((await history()).releases.map((row) => row.version)).toEqual([3, 2, 1])
    expect(await (await server.published!.request(`${liveURL}/`)).text()).toBe(originalHtml)
    server.close()
    // Model an abrupt process death with an expired worker lease, retaining the live pointer.
    const { sqlite } = openDatabase(dir)
    const interruptedId = randomUUID()
    sqlite
      .prepare(
        "INSERT INTO releases(id,site_id,revision,version,document,status,created_at,owner,lease_until) SELECT ?,site_id,revision,4,document,'building',?,'dead-worker',0 FROM releases WHERE id=?",
      )
      .run(interruptedId, Date.now(), firstId)
    sqlite.close()
    server = await createServer(options)
    await waitFor(interruptedId, 'failed')
    expect((await history()).publishedId).toBe(firstId)
    server.close()
    // Queued work survives a restart; two instances must claim it only once.
    const queuedId = randomUUID()
    const resumed = openDatabase(dir)
    resumed.sqlite
      .prepare(
        "INSERT INTO releases(id,site_id,revision,version,document,status,created_at) SELECT ?,site_id,revision,5,document,'queued',? FROM releases WHERE id=?",
      )
      .run(queuedId, Date.now(), firstId)
    resumed.sqlite.close()
    server = await createServer(options)
    const peer = await createServer(options)
    try {
      await waitFor(queuedId, 'ready')
      expect((await history()).publishedId).toBe(queuedId)
      expect((await history()).releases.filter((row) => row.id === queuedId)).toHaveLength(1)
    } finally {
      peer.close()
    }
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
}, 60000)
