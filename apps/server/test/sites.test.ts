import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createServer, type ServerOptions } from '../src/app.js'
import { openDatabase } from '../src/database.js'
import { type SiteEvent, siteEvents } from '../src/events.js'

const origin = 'http://localhost:3000'
const build = 30000
let options: ServerOptions
let server: Awaited<ReturnType<typeof createServer>>

const request = (route: string, cookie: string, method = 'GET', body?: unknown) =>
  server.app.request(`${origin}${route}`, {
    method,
    headers: { cookie, origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

async function register(email: string) {
  const response = await request('/api/auth/sign-up/email', '', 'POST', {
    name: 'Owner',
    email,
    password: 'a-unique-test-password-2026',
  })
  expect(response.status).toBe(200)
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ')
}

async function createSite(cookie: string, name = 'My site') {
  const response = await request('/api/sites', cookie, 'POST', { name })
  expect(response.status).toBe(201)
  return ((await response.json()) as { id: string }).id
}

const count = (table: string, site: string) => {
  const { sqlite } = openDatabase(options.dataDir)
  try {
    return (
      sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE site_id=?`).get(site) as {
        n: number
      }
    ).n
  } finally {
    sqlite.close()
  }
}

beforeEach(async () => {
  options = {
    dataDir: await mkdtemp(path.join(os.tmpdir(), 'lacuno-sites-')),
    templateDir: fileURLToPath(new URL('../../../templates/lacuno', import.meta.url)),
    baseURL: origin,
    publishBaseURL: 'http://localhost:3001',
    secret: 'sites-test-secret-6ea8114c2a7b4e68ba29c69b',
    allowSignup: true,
  }
  server = await createServer(options)
})

afterEach(async () => {
  server.close()
  await rm(options.dataDir, { recursive: true, force: true })
})

it('renames a site through its document and tells its open editors', async () => {
  const owner = await register('owner@example.test')
  const id = await createSite(owner)
  const events: SiteEvent[] = []
  const unsubscribe = siteEvents.subscribe(id, (event) => events.push(event))
  try {
    const response = await request(`/api/sites/${id}/name`, owner, 'PUT', { name: ' Renamed ' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ name: 'Renamed', revision: 1 })
    expect(events.map((event) => event.revision)).toEqual([1])
  } finally {
    unsubscribe()
  }
  const listed = (await (await request('/api/sites', owner)).json()) as { sites: object[] }
  expect(listed.sites).toEqual([expect.objectContaining({ id, name: 'Renamed', revision: 1 })])
  expect((await request(`/api/sites/${id}/name`, owner, 'PUT', { name: ' ' })).status).toBe(400)
  expect((await request(`/api/sites/${id}/name`, owner, 'PUT', {})).status).toBe(400)
  const unknown = await request('/api/sites/unknown/name', owner, 'PUT', { name: 'X' })
  expect(unknown.status).toBe(404)
})

it(
  'deletes a site with its releases and files, again without error, and never another owner’s',
  async () => {
    const owner = await register('owner@example.test')
    const other = await register('other@example.test')
    const id = await createSite(owner)
    const kept = await createSite(other)
    const route = `/api/sites/${id}`
    const releases = async () =>
      (await (await request(`${route}/releases`, owner)).json()) as {
        url: string
        releases: { status: string }[]
      }
    const publish = await request(`${route}/releases`, owner, 'POST', {
      expectedRevision: 0,
      expectedId: null,
    })
    expect(publish.status).toBe(202)
    expect((await request(route, owner, 'DELETE')).status).toBe(409)
    await expect
      .poll(async () => (await releases()).releases[0]?.status, { timeout: build })
      .toBe('ready')
    const { url } = await releases()
    const published = () => server.published!.request(url)
    expect((await published()).status).toBe(200)
    await mkdir(path.join(options.dataDir, 'builds', id), { recursive: true })

    expect((await request(route, owner, 'DELETE')).status).toBe(204)
    expect(existsSync(path.join(options.dataDir, 'sites', id))).toBe(false)
    expect(existsSync(path.join(options.dataDir, 'builds', id))).toBe(false)
    expect(count('releases', id)).toBe(0)
    expect(count('publications', id)).toBe(0)
    expect((await published()).status).toBe(404)
    expect((await request(`${route}/document`, owner)).status).toBe(404)
    expect((await request(route, owner, 'DELETE')).status).toBe(204)

    // Another owner's site is not found, so nothing is deleted.
    expect((await request(`/api/sites/${kept}`, owner, 'DELETE')).status).toBe(204)
    expect((await request(`/api/sites/${kept}/document`, other)).status).toBe(200)
  },
  build,
)
