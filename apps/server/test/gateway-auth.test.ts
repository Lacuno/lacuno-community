import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT } from 'jose'
import { expect, it } from 'vitest'
import { createServer } from '../src/app.js'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const issuer = 'http://cloud.localhost:4000'
const origin = 'http://runtime.editor.localhost:4000'
const secret = 'gateway-test-key-at-least-32-characters'
const settings = (dataDir: string) => ({
  dataDir,
  baseURL: origin,
  secret: 'local-test-secret-at-least-32-characters',
  templateDir: path.join(root, 'templates/freeflow'),
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

it('requires request-bound assertions, rejects replay/forgery, and persists gateway-only mode', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-gateway-'))
  let server = await createServer(settings(dir))
  const request = async (target = '/api/sites', method = 'GET', body = '', signed?: string) =>
    server.app.request(origin + target, {
      method,
      headers: {
        origin,
        'content-type': 'application/json',
        ...(signed ? { 'x-freeflow-assertion': signed } : {}),
      },
      ...(method === 'POST' ? { body } : {}),
    })
  try {
    expect((await request()).status).toBe(401)
    expect(await (await request('/api/config')).json()).toMatchObject({
      authentication: 'gateway',
      setupRequired: false,
      allowSignup: false,
    })
    const signed = await assertion()
    expect((await request('/api/sites', 'GET', '', signed)).status).toBe(200)
    expect((await request('/api/sites', 'GET', '', signed)).status).toBe(401)
    for (const changes of [
      { aud: 'http://other.localhost' },
      { iss: 'http://other.localhost' },
      { exp: 1 },
      { iat: Math.floor(Date.now() / 1000) + 60 },
      { exp: Math.floor(Date.now() / 1000) + 3600 },
      { sub: '' },
    ]) {
      expect(
        (await request('/api/sites', 'GET', '', await assertion('/api/sites', 'GET', '', changes)))
          .status,
      ).toBe(401)
    }
    expect((await request('/api/workspaces', 'GET', '', await assertion())).status).toBe(401)
    expect(
      (
        await request(
          '/api/sites',
          'POST',
          '{}',
          await assertion('/api/sites', 'POST', '{"name":"original"}'),
        )
      ).status,
    ).toBe(401)
    expect((await request('/api/sites', 'GET', '', `${signed.slice(0, -8)}forgery!`)).status).toBe(
      401,
    )
    expect(
      (await request('/api/setup', 'POST', '{}', await assertion('/api/setup', 'POST', '{}')))
        .status,
    ).toBe(403)
    expect(
      (
        await request(
          '/api/auth/sign-up/email',
          'POST',
          '{}',
          await assertion('/api/auth/sign-up/email', 'POST', '{}'),
        )
      ).status,
    ).toBe(403)
    const user = await (
      await request('/api/auth/get-session', 'GET', '', await assertion('/api/auth/get-session'))
    ).json()
    expect(user.user.id).toBe('cloud-user-1')
    const body = JSON.stringify({ name: 'Managed site' })
    expect(
      (await request('/api/sites', 'POST', body, await assertion('/api/sites', 'POST', body)))
        .status,
    ).toBe(201)
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
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})

it('will not silently replace existing local accounts with gateway authentication', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'freeflow-local-owner-'))
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
