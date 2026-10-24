import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createServer } from '../src/app.js'
import { backupWorkspace } from '../src/backup.js'
import { openDatabase } from '../src/database.js'
import { hashPassword, signAccess, verifyAccess, verifyPassword } from '../src/passwords.js'

const templateDir = fileURLToPath(new URL('../../../templates/lacuno', import.meta.url))
const origin = 'http://localhost:3000'
let dir = ''
let server: Awaited<ReturnType<typeof createServer>>
let site = ''
let cookie = ''

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-passwords-'))
  server = await createServer({
    dataDir: dir,
    templateDir,
    baseURL: origin,
    publishBaseURL: 'http://localhost:3001',
    secret: 'passwords-test-secret-8f2d6c1a9b3e4d7f',
    allowSignup: true,
  })
  const headers = { origin, 'content-type': 'application/json' }
  const signUp = await server.app.request(`${origin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Owner',
      email: 'owner@example.test',
      password: 'owner-password',
    }),
  })
  cookie = signUp.headers.getSetCookie()[0]!.split(';')[0]!
  const created = await server.app.request(`${origin}/api/sites`, {
    method: 'POST',
    headers: { ...headers, cookie },
    body: JSON.stringify({ name: 'Private studio' }),
  })
  site = ((await created.json()) as { id: string }).id
  // A release's files as a build leaves them, on both targets, without building one.
  const release = randomUUID()
  const dist = path.join(dir, 'builds', site, release, 'dist')
  await mkdir(path.join(dist, 'assets'), { recursive: true })
  await writeFile(path.join(dist, 'index.html'), '<h1>Inside</h1>')
  await writeFile(path.join(dist, 'assets', 'site.css'), 'h1{color:red}')
  const { sqlite } = openDatabase(dir)
  sqlite.pragma('foreign_keys = OFF')
  for (const target of ['production', 'testing'])
    sqlite.prepare('INSERT INTO publications VALUES (?, ?, ?)').run(site, target, release)
  sqlite.close()
})
afterAll(async () => {
  server.close()
  await rm(dir, { recursive: true, force: true })
})

const api = (route: string, method = 'GET', body?: unknown) =>
  server.app.request(`${origin}/api/sites/${site}/passwords${route}`, {
    method,
    headers: { cookie, origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
let ip = 0
/** A request to the published testing site, from a new visitor unless `from` names one. */
const visit = (
  route = '/',
  { from = `203.0.113.${++ip}`, ...headers }: Record<string, string> = {},
  init: RequestInit = {},
) =>
  server.published!.request(`http://${site}-testing.localhost:3001${route}`, {
    ...init,
    headers: { 'x-forwarded-for': from, ...headers, ...init.headers },
  })
const unlock = (password: string, next = '/about?x=1', from?: string) =>
  visit('/_lacuno/unlock', from ? { from } : {}, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password, next }),
  })
/** The access cookie an unlock set, as a browser sends it back. */
const access = (response: Response) => response.headers.getSetCookie()[0]!.split(';')[0]!

it('hashes passwords with scrypt and signs access for one site, target, version and time', async () => {
  const stored = await hashPassword('correct horse')
  expect(stored).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/)
  expect(await verifyPassword('correct horse', stored)).toBe(true)
  expect(await verifyPassword('correct horsf', stored)).toBe(false)
  const key = Buffer.alloc(32, 1)
  const grant = { siteId: 'a', target: 'testing', version: 1 } as const
  const value = signAccess(key, grant)
  expect(verifyAccess(key, value, grant)).toBe(true)
  for (const other of [
    { ...grant, version: 2 },
    { ...grant, target: 'production' as const },
    { ...grant, siteId: 'b' },
  ])
    expect(verifyAccess(key, value, other)).toBe(false)
  expect(verifyAccess(Buffer.alloc(32, 2), value, grant)).toBe(false)
  expect(verifyAccess(key, signAccess(key, grant, Date.now() - 31 * 86_400_000), grant)).toBe(false)
  expect(verifyAccess(key, undefined, grant)).toBe(false)
})

it('sets, lists and removes a password without ever answering its hash', async () => {
  expect(await (await api('')).json()).toEqual({ production: false, testing: false })
  expect((await api('/testing', 'PUT', { password: 'short' })).status).toBe(400)
  expect((await api('/testing', 'PUT', { password: 'x'.repeat(201) })).status).toBe(400)
  expect((await api('/staging', 'PUT', { password: 'long enough' })).status).toBe(404)
  expect((await api('/testing', 'PUT', { password: 'open sesame' })).status).toBe(204)
  const listed = await (await api('')).text()
  expect(JSON.parse(listed)).toEqual({ production: false, testing: true })
  const document = await (
    await server.app.request(`${origin}/api/sites/${site}/document`, { headers: { cookie } })
  ).text()
  for (const answer of [listed, document]) expect(answer).not.toMatch(/sesame|[0-9a-f]{32}:/)
})

it('answers a protected target with its password page, keeps assets open and refuses forms', async () => {
  const page = await visit('/about?x=1')
  expect(page.status).toBe(401)
  expect(page.headers.get('cache-control')).toBe('private, no-store')
  expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  const html = await page.text()
  expect(html).toContain('<h1>Private studio</h1>')
  expect(html).toContain('action="/_lacuno/unlock"')
  expect(html).toContain('name="next" value="/about?x=1"')
  expect(html).not.toContain('Inside')
  const asset = await visit('/assets/site.css')
  expect([asset.status, await asset.text()]).toEqual([200, 'h1{color:red}'])
  expect(asset.headers.get('cache-control')).toContain('immutable')
  const form = await visit('/_lacuno/forms', {}, { method: 'POST', body: 'a=b' })
  expect(form.status).toBe(401)
  // The live site has no password.
  const live = await server.published!.request(`http://${site}.localhost:3001/`)
  expect([live.status, await live.text()]).toEqual([200, '<h1>Inside</h1>'])
})

it('unlocks with the right password and returns to the page asked for', async () => {
  const wrong = await unlock('open sesamE')
  expect(wrong.status).toBe(401)
  expect(await wrong.text()).toContain('That password is not right.')
  const right = await unlock('open sesame')
  expect(right.status).toBe(303)
  expect(right.headers.get('location')).toBe('/about?x=1')
  const set = right.headers.getSetCookie()[0]!
  expect(set).toMatch(
    /^lacuno_access=\d+\.[\w-]+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/,
  )
  const page = await visit('/', { cookie: access(right) })
  expect([page.status, await page.text()]).toEqual([200, '<h1>Inside</h1>'])
  expect(page.headers.get('cache-control')).toBe('private, no-store')
  const forged = `lacuno_access=${Date.now() + 60_000}.${access(right).split('.')[1]}`
  expect((await visit('/', { cookie: forged })).status).toBe(401)
})

it('redirects only to a path on the same host', async () => {
  for (const next of [
    'https://elsewhere.example/x',
    '//elsewhere.example/x',
    '/\\elsewhere.example',
  ])
    expect((await unlock('open sesame', next)).headers.get('location')).toBe('/')
})

it('limits guesses to ten a minute per visitor and site', async () => {
  for (let guess = 0; guess < 10; guess++)
    expect((await unlock('wrong guess', '/', '198.51.100.9')).status).toBe(401)
  const limited = await unlock('open sesame', '/', '198.51.100.9')
  expect(limited.status).toBe(429)
  expect(await limited.text()).toContain('Too many tries')
  expect((await unlock('open sesame', '/', '198.51.100.10')).status).toBe(303)
})

it('signs everyone out when the password changes or goes, and opens the site without one', async () => {
  const before = access(await unlock('open sesame'))
  expect((await api('/testing', 'PUT', { password: 'new sesame' })).status).toBe(204)
  expect((await visit('/', { cookie: before })).status).toBe(401)
  const after = access(await unlock('new sesame'))
  expect((await visit('/', { cookie: after })).status).toBe(200)
  expect((await api('/testing', 'DELETE')).status).toBe(204)
  const open = await visit('/')
  expect([open.status, open.headers.get('cache-control')]).toEqual([200, 'no-cache'])
  expect((await api('/testing', 'PUT', { password: 'new sesame' })).status).toBe(204)
  expect((await visit('/', { cookie: after })).status).toBe(401)
})

it('leaves passwords out of backups', async () => {
  const backup = path.join(await mkdtemp(path.join(os.tmpdir(), 'lacuno-passwords-backup-')), 'b')
  try {
    await backupWorkspace(dir, backup)
    const { sqlite } = openDatabase(dir)
    const hash = sqlite.prepare('SELECT hash FROM site_password').pluck().get() as string
    sqlite.close()
    const bytes = await readFile(path.join(backup, 'lacuno.sqlite'))
    expect(bytes.includes(hash.split(':')[1]!)).toBe(false)
    const { sqlite: copy } = openDatabase(backup)
    expect(copy.prepare('SELECT count(*) FROM site_password').pluck().get()).toBe(0)
    copy.close()
  } finally {
    await rm(path.dirname(backup), { recursive: true, force: true })
  }
})

it('answers 404 behind a gateway, where Cloud owns passwords', async () => {
  const gatewayDir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-passwords-gateway-'))
  const issuer = 'http://cloud.localhost:4000'
  const secret = 'gateway-test-key-at-least-32-characters'
  const gateway = await createServer({
    dataDir: gatewayDir,
    templateDir,
    baseURL: origin,
    secret: 'local-test-secret-at-least-32-characters',
    gateway: { issuer, secret },
  })
  const request = async (target: string, method = 'GET', body = '') => {
    const now = Math.floor(Date.now() / 1000)
    const assertion = await new SignJWT({
      sub: 'cloud-user-1',
      name: 'Gateway owner',
      email: 'owner@example.test',
      jti: randomUUID(),
      iat: now,
      exp: now + 30,
      method,
      target,
      bodyHash: createHash('sha256').update(body).digest('hex'),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(issuer)
      .setAudience(origin)
      .sign(new TextEncoder().encode(secret))
    return gateway.app.request(origin + target, {
      method,
      headers: { origin, 'content-type': 'application/json', 'x-lacuno-assertion': assertion },
      ...(body ? { body } : {}),
    })
  }
  try {
    const created = await request('/api/sites', 'POST', '{"name":"Managed"}')
    const { id } = (await created.json()) as { id: string }
    expect((await request(`/api/sites/${id}/passwords`)).status).toBe(404)
    const body = '{"password":"open sesame"}'
    expect((await request(`/api/sites/${id}/passwords/testing`, 'PUT', body)).status).toBe(404)
  } finally {
    gateway.close()
    await rm(gatewayDir, { recursive: true, force: true })
  }
})
