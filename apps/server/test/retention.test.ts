import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from '../src/app.js'
import { openDatabase } from '../src/database.js'
import { Releases } from '../src/releases.js'

const origin = 'http://localhost:3000'
const publishBaseURL = 'http://localhost:3001'

describe('release retention', () => {
  let dir = ''
  let server: Awaited<ReturnType<typeof createServer>>
  let cookie = ''
  let site = ''
  let releases: Releases
  let sqlite: ReturnType<typeof openDatabase>['sqlite']
  /** Release ids by version, 1 to 13 and the ones added later. */
  const ids: string[] = []
  const folder = (id: string) => path.join(dir, 'builds', site, id)
  const status = (id: string) =>
    sqlite.prepare('SELECT status FROM releases WHERE id=?').pluck().get(id) as string
  const request = (route: string, body?: unknown) =>
    server.app.request(origin + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  /** A built release, as a publish leaves it. */
  const add = async (state = 'ready') => {
    const id = randomUUID()
    const version = ids.length + 1
    sqlite
      .prepare(
        "INSERT INTO releases(id,site_id,revision,version,target,document,status,created_at,owner,lease_until) VALUES(?,?,1,?,'production','{}',?,?,?,?)",
      )
      .run(id, site, version, state, version, 'elsewhere', Date.now() + 3_600_000)
    await mkdir(path.join(folder(id), 'dist'), { recursive: true })
    await writeFile(path.join(folder(id), 'dist', 'index.html'), `v${version}`)
    ids.push(id)
    return id
  }
  const publish = (target: string, id: string) =>
    sqlite
      .prepare(
        'INSERT INTO publications(site_id,target,release_id) VALUES(?,?,?) ON CONFLICT(site_id,target) DO UPDATE SET release_id=excluded.release_id',
      )
      .run(site, target, id)

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-retention-'))
    server = await createServer({
      dataDir: dir,
      templateDir: fileURLToPath(new URL('../../../templates/lacuno', import.meta.url)),
      baseURL: origin,
      publishBaseURL,
      secret: 'retention-test-secret-192836519283651928365',
      allowSignup: true,
    })
    const signedUp = await request('/api/auth/sign-up/email', {
      name: 'Publisher',
      email: 'retention@example.test',
      password: 'retention-test-password',
    })
    cookie = signedUp.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ')
    site = ((await (await request('/api/sites', { name: 'Kept' })).json()) as { id: string }).id
    sqlite = openDatabase(dir).sqlite
    // A second instance on the same data, as with several API processes.
    releases = new Releases(sqlite, dir, publishBaseURL)
  })
  afterAll(async () => {
    releases.close()
    sqlite.close()
    server.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps the published releases and the newest ten others, and removes leftovers', async () => {
    for (let version = 1; version <= 13; version++) await add()
    publish('production', ids[1]!)
    publish('testing', ids[12]!)
    // Left by crashes: a folder without a release, and one of a failed release; neither the
    // images cache nor anything else that is not a release id goes.
    const stray = folder(randomUUID())
    await mkdir(stray, { recursive: true })
    const failed = await add('failed')
    for (const name of ['images', 'notes']) await mkdir(folder(name), { recursive: true })

    await releases.prune(site)
    // Only v1 goes: v2 and v13 are published, v3 to v12 the newest ten others.
    for (const id of ids.slice(1, 13)) {
      expect(status(id)).toBe('ready')
      expect(existsSync(folder(id))).toBe(true)
    }
    expect(existsSync(folder(ids[0]!))).toBe(false)
    // It leaves the history.
    const { releases: history } = (await (await request(`/api/sites/${site}/releases`)).json()) as {
      releases: { id: string }[]
    }
    expect(history.map((row) => row.id)).not.toContain(ids[0])
    expect(status(ids[0]!)).toBeUndefined()
    expect(existsSync(stray)).toBe(false)
    expect(existsSync(folder(failed))).toBe(false)
    expect(existsSync(folder('images'))).toBe(true)
    expect(existsSync(folder('notes'))).toBe(true)

    // A second prune changes nothing.
    const before = sqlite.prepare('SELECT id,status,error FROM releases ORDER BY version').all()
    await releases.prune(site)
    expect(sqlite.prepare('SELECT id,status,error FROM releases ORDER BY version').all()).toEqual(
      before,
    )
  })

  it('keeps a release that is promoted, and prunes after the promote', async () => {
    await add()
    await add()
    // With two more, v3 and v4 would go; promoting v4 keeps it, and v2, no longer live, goes.
    releases.rollback(site, ids[3]!, ids[1]!, 'production')
    await expect.poll(() => existsSync(folder(ids[1]!))).toBe(false)
    expect(status(ids[1]!)).toBeUndefined()
    expect(status(ids[2]!)).toBeUndefined()
    expect(status(ids[3]!)).toBe('ready')
    expect(existsSync(folder(ids[3]!))).toBe(true)
    expect(status(ids[4]!)).toBe('ready')
  })

  it('leaves the releases alone while a build is running', async () => {
    const ready = await add()
    const building = await add('building')
    const before = sqlite.prepare('SELECT id,status FROM releases ORDER BY version').all()
    await releases.prune(site)
    expect(sqlite.prepare('SELECT id,status FROM releases ORDER BY version').all()).toEqual(before)
    expect(existsSync(folder(building))).toBe(true)
    expect(existsSync(folder(ready))).toBe(true)
  })
})
