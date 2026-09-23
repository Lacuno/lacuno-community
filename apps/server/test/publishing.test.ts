import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ServerOptions } from '../src/app.js'
import { backupWorkspace, restoreWorkspace } from '../src/backup.js'
import { openDatabase } from '../src/database.js'
import { PublicationReader } from '../src/publication-reader.js'

const origin = 'http://localhost:3000'
type History = {
  publishedId: string | null
  url: string
  testingId: string | null
  testingUrl: string
  releases: { id: string; revision: number; version: number; name: string | null; status: string }[]
}
const build = 30000

describe('publishing', () => {
  let dir = ''
  let options: ServerOptions
  let server: Awaited<ReturnType<typeof createServer>>
  let cookie = ''
  let other = ''
  let route = ''
  let firstId = ''
  let secondId = ''
  let liveURL = ''
  let originalHtml = ''
  const request = (path: string, cookie = '', body?: unknown, requestOrigin = origin) =>
    server.app.request(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, origin: requestOrigin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const live = (path = '/', init?: RequestInit) => server.published!.request(liveURL + path, init)
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
  const history = async () => (await (await request(`${route}/releases`, cookie)).json()) as History
  const publish = async (expectedRevision: number, expectedId: string | null, name?: string) => {
    const response = await request(`${route}/releases`, cookie, {
      expectedRevision,
      expectedId,
      name,
    })
    expect(response.status).toBe(202)
    return ((await response.json()) as { id: string }).id
  }
  const waitFor = (releaseId: string, status: string) =>
    expect
      .poll(async () => (await history()).releases.find((row) => row.id === releaseId)?.status, {
        timeout: 20000,
      })
      .toBe(status)
  const edit = (expectedRevision: number, operation: Record<string, unknown>) =>
    request(`${route}/document/apply`, cookie, { expectedRevision, operations: [operation] })

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-publish-'))
    options = {
      dataDir: dir,
      templateDir: fileURLToPath(new URL('../../../templates/freeflow', import.meta.url)),
      baseURL: origin,
      publishBaseURL: 'http://localhost:3001',
      secret: 'publishing-test-secret-192836519283651928365',
      allowSignup: true,
    }
    server = await createServer(options)
    cookie = await register('publisher@example.test')
    other = await register('other-publisher@example.test')
    const created = await request('/api/sites', cookie, { name: 'Release test' })
    const { id } = (await created.json()) as { id: string }
    route = `/api/sites/${id}`
    // A well-edited draft still starts its independent publishing history at v1.
    const seed = openDatabase(dir)
    seed.sqlite
      .prepare(
        "UPDATE sites SET revision=160, document=json_set(document, '$.revision', 160) WHERE id=?",
      )
      .run(id)
    seed.sqlite.close()
  })
  afterAll(async () => {
    server.close()
    await rm(dir, { recursive: true, force: true })
  })

  it(
    'checks ownership and revisions, then publishes a pinned snapshot of the draft',
    async () => {
      expect((await request(`${route}/releases`)).status).toBe(401)
      expect((await request(`${route}/releases`, other)).status).toBe(404)
      expect((await request(`${route}/releases`, cookie, { expectedRevision: 0 })).status).toBe(400)
      const stale = { expectedRevision: 1, expectedId: null }
      expect((await request(`${route}/releases`, other, stale)).status).toBe(404)
      expect((await request(`${route}/releases`, cookie, stale)).status).toBe(409)
      firstId = await publish(160, null)
      const queued = { expectedRevision: 0, expectedId: null }
      expect((await request(`${route}/releases`, cookie, queued)).status).toBe(409)
      const edited = await edit(160, {
        type: 'node.update',
        id: 'n-home-title',
        text: { type: 'static', value: 'An unpublished draft' },
      })
      expect(edited.status).toBe(200)
      await waitFor(firstId, 'ready')
      expect((await history()).releases[0]).toMatchObject({ version: 1, revision: 160 })
      liveURL = (await history()).url
      const published = await live()
      expect(published.status).toBe(200)
      expect(published.headers.get('x-freeflow-release')).toBe(firstId)
      originalHtml = await published.text()
      expect(originalHtml).not.toContain('An unpublished draft')
    },
    build,
  )

  it(
    'snapshots online while serving and restores a working instance elsewhere',
    async () => {
      const recovery = await mkdtemp(path.join(os.tmpdir(), 'freeflow-recovery-'))
      try {
        const backup = path.join(recovery, 'backup')
        let done = false
        const copying = backupWorkspace(dir, backup).finally(() => {
          done = true
        })
        let reads = 0
        while (!done) {
          const response = await live()
          expect(response.status).toBe(200)
          expect(await response.text()).toBe(originalHtml)
          reads++
        }
        await copying
        expect(reads).toBeGreaterThan(0)
        const restoredDir = path.join(recovery, 'restored')
        await restoreWorkspace(backup, restoredDir)
        const restored = await createServer({ ...options, dataDir: restoredDir })
        try {
          expect(await (await restored.published!.request(`${liveURL}/`)).text()).toBe(originalHtml)
          const document = await restored.app.request(`${origin}${route}/document`, {
            headers: { cookie },
          })
          expect(document.status).toBe(200)
          expect(JSON.stringify(await document.json())).toContain('An unpublished draft')
        } finally {
          restored.close()
        }
      } finally {
        await rm(recovery, { recursive: true, force: true })
      }
    },
    build,
  )

  it('serves only release output on the publishing listener', async () => {
    expect((await live('/about')).status).toBe(200)
    expect((await live('/freeflow.json')).status).toBe(404)
    for (const suffix of [
      '/assets/%2e%2e%2ffreeflow.json',
      '/%ZZ',
      '/.cache/astro.config.mjs',
      '/assets/%5c..%5cfreeflow.json',
    ])
      expect((await live(suffix)).status).toBe(404)
    const siteId = route.slice('/api/sites/'.length)
    await symlink(
      path.join(dir, 'freeflow.sqlite'),
      path.join(dir, 'builds', siteId, firstId, 'dist', 'private.sqlite'),
    )
    expect((await live('/private.sqlite')).status).toBe(404)
    const head = await live('/', { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect((await live('/api/sites')).status).toBe(404)
    expect((await server.published!.request('http://localhost:3001/')).status).toBe(404)
    const assetPath = originalHtml.match(/(?:src|href)="(\/(?:_astro|assets)\/[^" ]+)"/)?.[1]
    expect(assetPath).toBeTruthy()
    expect((await live(assetPath)).headers.get('cache-control')).toContain('immutable')
    const crossOrigin = { expectedRevision: 161, expectedId: firstId }
    expect((await request(`${route}/releases`, cookie, crossOrigin, liveURL)).status).toBe(403)
  })

  it(
    'keeps the live release when a later build fails and enforces rollback rules',
    async () => {
      secondId = await publish(161, firstId)
      await waitFor(secondId, 'ready')
      expect((await history()).releases[0]).toMatchObject({ version: 2, revision: 161 })
      expect(await (await live()).text()).toContain('An unpublished draft')
      const broken = await edit(161, {
        type: 'asset.create',
        id: 'a-missing',
        name: 'Missing image',
        kind: 'image',
        hash: 'a'.repeat(64),
        mime: 'image/png',
        size: 10,
      })
      expect(broken.status).toBe(200)
      const brokenId = await publish(162, secondId)
      await waitFor(brokenId, 'failed')
      expect((await history()).releases[0]).toMatchObject({ version: 3, revision: 162 })
      expect((await history()).publishedId).toBe(secondId)
      expect(await (await live()).text()).toContain('An unpublished draft')
      const activate = (releaseId: string, expectedId: string | null, as = cookie, site = route) =>
        request(`${site}/releases/${releaseId}/activate`, as, { expectedId })
      const another = (await (
        await request('/api/sites', cookie, { name: 'Another site' })
      ).json()) as {
        id: string
      }
      expect((await activate(firstId, null, cookie, `/api/sites/${another.id}`)).status).toBe(404)
      expect((await activate(brokenId, secondId)).status).toBe(404)
      expect((await activate(firstId, secondId, other)).status).toBe(404)
      expect((await activate(firstId, secondId)).status).toBe(200)
      expect((await activate(secondId, secondId)).status).toBe(409)
      const draft = (await (await request(`${route}/document`, cookie)).json()) as {
        revision: number
      }
      expect(draft.revision).toBe(162)
    },
    build,
  )

  it(
    'restores history and recovers interrupted or queued builds across restarts',
    async () => {
      server.close()
      server = await createServer(options)
      expect((await history()).releases).toHaveLength(3)
      expect((await history()).publishedId).toBe(firstId)
      expect((await history()).releases.map((row) => row.version)).toEqual([3, 2, 1])
      expect(await (await live()).text()).toBe(originalHtml)
      server.close()
      // Model an abrupt process death with an expired worker lease, retaining the live pointer.
      const interruptedId = randomUUID()
      const { sqlite } = openDatabase(dir)
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
    },
    build,
  )

  it(
    'names a release when publishing and renames it later',
    async () => {
      // The draft still references the missing asset; a failed release carries its name too.
      const namedId = await publish(162, (await history()).publishedId, '  Spring launch  ')
      await waitFor(namedId, 'failed')
      const release = (id: string) => history().then((h) => h.releases.find((row) => row.id === id))
      expect(await release(namedId)).toMatchObject({ version: 6, name: 'Spring launch' })
      expect(await release(firstId)).toMatchObject({ name: null })
      const rename = (releaseId: string, name: unknown, as = cookie) =>
        request(`${route}/releases/${releaseId}/name`, as, { name })
      expect((await rename(firstId, 'Launch day')).status).toBe(200)
      expect(await release(firstId)).toMatchObject({ name: 'Launch day' })
      expect((await rename(namedId, ' ')).status).toBe(200)
      expect(await release(namedId)).toMatchObject({ name: null })
      expect((await rename(firstId, 'x'.repeat(81))).status).toBe(400)
      expect((await rename(firstId, 'Taken', other)).status).toBe(404)
      expect((await rename(randomUUID(), 'Missing')).status).toBe(404)
      expect(await release(firstId)).toMatchObject({ name: 'Launch day' })
    },
    build,
  )

  it(
    'publishes to testing, promotes it without a rebuild and rolls production back on its own',
    async () => {
      // Drop the missing asset so the draft builds again.
      expect((await edit(162, { type: 'asset.delete', id: 'a-missing' })).status).toBe(200)
      const production = (await history()).publishedId
      const { testingUrl } = await history()
      const testing = (path = '/') => server.published!.request(testingUrl + path)
      const { sqlite } = openDatabase(dir)
      const reader = new PublicationReader(sqlite, dir, 'http://localhost:3001')
      try {
        const listed = reader.publications()
        expect(testingUrl).toBe(liveURL.replace('.localhost', '-testing.localhost'))
        expect((await testing()).status).toBe(404)
        expect((await testing()).headers.get('x-robots-tag')).toBe('noindex, nofollow')
        const toTesting = (expectedId: string | null) =>
          request(`${route}/releases`, cookie, {
            expectedRevision: 163,
            expectedId,
            target: 'testing',
          })
        // The pointer guarded is the testing one, not production.
        expect((await toTesting(production)).status).toBe(409)
        const response = await toTesting(null)
        expect(response.status).toBe(202)
        const sent = ((await response.json()) as { id: string; target: string }).id
        await waitFor(sent, 'ready')
        expect(await history()).toMatchObject({ publishedId: production, testingId: sent })
        const page = await testing()
        expect(page.headers.get('x-freeflow-release')).toBe(sent)
        expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')
        expect((await testing('/missing')).headers.get('x-robots-tag')).toBe('noindex, nofollow')
        const livePage = await live()
        expect(livePage.headers.get('x-freeflow-release')).toBe(production)
        expect(livePage.headers.get('x-robots-tag')).toBeNull()
        // The cloud runtime's `--list` shape and rows are unchanged by a testing publication.
        expect(reader.publications()).toEqual(listed)
        expect(listed).toEqual([
          { siteId: route.slice('/api/sites/'.length), releaseId: production },
        ])

        const activate = (releaseId: string, expectedId: string | null, target: string) =>
          request(`${route}/releases/${releaseId}/activate`, cookie, { expectedId, target })
        const count = (await history()).releases.length
        expect((await activate(sent, sent, 'production')).status).toBe(409)
        expect((await activate(sent, production, 'production')).status).toBe(200)
        expect(await history()).toMatchObject({ publishedId: sent, testingId: sent })
        expect((await history()).releases).toHaveLength(count)
        expect((await live()).headers.get('x-freeflow-release')).toBe(sent)

        // Rolling production back leaves testing where it was.
        expect((await activate(production!, sent, 'production')).status).toBe(200)
        expect(await history()).toMatchObject({ publishedId: production, testingId: sent })
        expect((await testing()).headers.get('x-freeflow-release')).toBe(sent)

        const failed = (await history()).releases.find((row) => row.status === 'failed')!
        expect((await activate(failed.id, sent, 'testing')).status).toBe(404)
        const next = await toTesting(sent)
        const building = ((await next.json()) as { id: string }).id
        expect((await activate(building, production, 'production')).status).toBe(409)
        await waitFor(building, 'ready')
        expect(await history()).toMatchObject({ publishedId: production, testingId: building })
      } finally {
        sqlite.close()
      }
    },
    build,
  )
})
