import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from '../src/app.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const issuer = 'http://cloud.localhost:4000'
const origin = 'http://runtime.editor.localhost:4000'
const secret = 'gateway-test-key-at-least-32-characters'
const settings = (dataDir: string) => ({
  dataDir,
  baseURL: origin,
  secret: 'local-test-secret-at-least-32-characters',
  templateDir: path.join(root, 'templates/lacuno'),
  gateway: { issuer, secret },
})
async function assertion(
  target = '/api/sites',
  method = 'GET',
  body = '',
  changes: Record<string, unknown> = {},
) {
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({
    iss: issuer,
    aud: origin,
    sub: 'cloud-user-1',
    name: 'Gateway owner',
    email: 'owner@example.test',
    jti: randomUUID(),
    iat: now,
    exp: now + 30,
    method,
    target,
    bodyHash: createHash('sha256').update(body).digest('hex'),
    ...changes,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret))
}

describe('gateway mode', () => {
  let dir = ''
  let server: Awaited<ReturnType<typeof createServer>>
  let signed = ''
  const request = (target = '/api/sites', method = 'GET', body = '', assertion?: string) =>
    server.app.request(origin + target, {
      method,
      headers: {
        origin,
        'content-type': 'application/json',
        ...(assertion ? { 'x-lacuno-assertion': assertion } : {}),
      },
      ...(method === 'POST' ? { body } : {}),
    })
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-gateway-'))
    server = await createServer(settings(dir))
    signed = await assertion()
  })
  afterAll(async () => {
    server.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('advertises gateway authentication and rejects unsigned requests', async () => {
    expect((await request()).status).toBe(401)
    expect(await (await request('/api/config')).json()).toMatchObject({
      authentication: 'gateway',
      setupRequired: false,
      allowSignup: false,
    })
  })

  it('accepts a request-bound assertion exactly once', async () => {
    expect((await request('/api/sites', 'GET', '', signed)).status).toBe(200)
    expect((await request('/api/sites', 'GET', '', signed)).status).toBe(401)
  })

  it('rejects forged, mistargeted, stale or unbound assertions', async () => {
    const now = Math.floor(Date.now() / 1000)
    for (const changes of [
      { aud: 'http://other.localhost' },
      { iss: 'http://other.localhost' },
      { exp: 1 },
      { iat: now + 60 },
      { exp: now + 3600 },
      { sub: '' },
    ]) {
      const forged = await assertion('/api/sites', 'GET', '', changes)
      expect((await request('/api/sites', 'GET', '', forged)).status).toBe(401)
    }
    expect((await request('/api/workspaces', 'GET', '', await assertion())).status).toBe(401)
    const otherBody = await assertion('/api/sites', 'POST', '{"name":"original"}')
    expect((await request('/api/sites', 'POST', '{}', otherBody)).status).toBe(401)
    const tampered = `${(await assertion()).slice(0, -8)}forgery!`
    expect((await request('/api/sites', 'GET', '', tampered)).status).toBe(401)
  })

  it('keeps local account routes closed and maps the gateway user to the owner', async () => {
    const setup = await assertion('/api/setup', 'POST', '{}')
    expect((await request('/api/setup', 'POST', '{}', setup)).status).toBe(403)
    const signup = await assertion('/api/auth/sign-up/email', 'POST', '{}')
    expect((await request('/api/auth/sign-up/email', 'POST', '{}', signup)).status).toBe(403)
    const session = await assertion('/api/auth/get-session')
    const user = await (await request('/api/auth/get-session', 'GET', '', session)).json()
    expect(user.user.id).toBe('cloud-user-1')
    const body = JSON.stringify({ name: 'Managed site' })
    const create = await assertion('/api/sites', 'POST', body)
    expect((await request('/api/sites', 'POST', body, create)).status).toBe(201)
  })

  it('persists gateway identity and consumed nonces across restarts', async () => {
    server.close()
    const { gateway: _, ...local } = settings(dir)
    await expect(createServer(local)).rejects.toThrow('Gateway configuration is required')
    await expect(
      createServer({ ...settings(dir), gateway: { issuer: 'http://changed.localhost', secret } }),
    ).rejects.toThrow('Gateway identity cannot change')
    server = await createServer(settings(dir))
    expect((await request('/api/sites', 'GET', '', signed)).status).toBe(401)
    const sites = await (await request('/api/sites', 'GET', '', await assertion())).json()
    expect(sites.sites).toHaveLength(1)
  })
})

it('will not silently replace existing local accounts with gateway authentication', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-local-owner-'))
  const { gateway: _, ...local } = settings(dir)
  const server = await createServer({ ...local, allowSignup: true })
  try {
    const response = await server.app.request(`${origin}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Local owner',
        email: 'local@example.test',
        password: 'local-owner-password',
      }),
    })
    expect(response.status).toBe(200)
    await expect(createServer(settings(dir))).rejects.toThrow('without local accounts')
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
