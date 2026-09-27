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
import Database from 'better-sqlite3'
import { decodeJwt, jwtVerify, SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from '../src/app.js'
import { type SiteEvent, siteEvents } from '../src/events.js'

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
    // Without a relay the runtime cannot fetch Client ID Metadata Documents, so it only registers.
    const metadata = await (await request('/.well-known/oauth-authorization-server')).json()
    expect(metadata.registration_endpoint).toBe(`${origin}/api/auth/oauth2/register`)
    expect(metadata).not.toHaveProperty('client_id_metadata_document_supported')
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
    // The editor shows the workspace's name when the gateway asserts one.
    const named = await assertion('/api/auth/get-session', 'GET', '', { workspace: 'Studio' })
    const workspace = await (await request('/api/auth/get-session', 'GET', '', named)).json()
    expect(workspace.user.workspace).toBe('Studio')
    const body = JSON.stringify({ name: 'Managed site' })
    const create = await assertion('/api/sites', 'POST', body)
    expect((await request('/api/sites', 'POST', body, create)).status).toBe(201)
  })

  it('enforces the asserted role: viewers read, editors do not publish, absent is the owner', async () => {
    const as = async (role: string, target: string, method = 'GET', body = '') =>
      request(
        target,
        method,
        body,
        await assertion(target, method, body, { sub: `cloud-${role}`, role }),
      )
    expect((await as('viewer', '/api/sites')).status).toBe(200)
    expect((await as('viewer', '/api/sites', 'POST', '{"name":"Viewer site"}')).status).toBe(403)
    expect((await as('viewer', '/api/auth/oauth2/authorize?client_id=x')).status).toBe(403)
    const session = await (await as('editor', '/api/auth/get-session')).json()
    expect(session.user).toMatchObject({ id: 'cloud-editor', role: 'editor' })
    expect((await as('editor', '/api/sites/any/releases', 'POST', '{}')).status).toBe(403)
    expect((await as('editor', '/api/sites/any/releases/r/activate', 'POST', '{}')).status).toBe(
      403,
    )
    // Past the role check, the site is looked up.
    expect((await as('owner', '/api/sites/any/releases', 'POST', '{}')).status).toBe(404)
    const owner = await assertion('/api/sites/any/releases', 'POST', '{}')
    expect((await request('/api/sites/any/releases', 'POST', '{}', owner)).status).toBe(404)
    expect((await as('admin', '/api/sites')).status).toBe(401)
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

describe('connecting an AI app through the gateway', () => {
  const system = {
    sub: 'lacuno-cloud',
    name: 'Lacuno Cloud',
    email: 'system@lacuno.invalid',
    system: true,
  }
  const json = { origin, 'content-type': 'application/json' }
  const form = { 'content-type': 'application/x-www-form-urlencoded' }
  const documentURL = 'https://app.example/oauth/client.json'
  const privateURL = 'https://internal.example/oauth/client.json'
  let dir = ''
  let server: Awaited<ReturnType<typeof createServer>>
  let siteId = ''
  let resource = ''
  // A fake Cloud relay: it checks the relay token and serves one stored metadata document, and
  // for AI apps' files a redirect to one image.
  const relayCalls: { url: string; valid: boolean }[] = []
  const fileCalls: string[] = []
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('image')])
  const relay = createHttpServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const { url } = JSON.parse(body) as { url: string }
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? ''
    const audience = String(decodeJwt(token).aud)
    const valid = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      issuer: origin,
      audience: ['lacuno-cimd-relay', 'lacuno-file-relay'],
      maxTokenAge: 30,
    }).then(
      ({ payload }) => payload.url === url && payload.exp! - payload.iat! <= 30,
      () => false,
    )
    if (valid && audience === 'lacuno-file-relay') {
      fileCalls.push(url)
      if (url === 'https://images.example/photo')
        return response.writeHead(302, { location: '/photo.png' }).end()
      if (url === 'https://images.example/photo.png')
        return response.writeHead(200, { 'content-type': 'image/png' }).end(png)
    } else relayCalls.push({ url, valid })
    if (valid && url === documentURL)
      return response
        .writeHead(200, {
          'content-type': 'application/json',
          'cache-control': 'max-age=300',
          'x-lacuno-relay': 'upstream',
        })
        .end(
          JSON.stringify({
            client_id: documentURL,
            client_name: 'Example App',
            redirect_uris: ['https://app.example/callback'],
            token_endpoint_auth_method: 'none',
          }),
        )
    const error = valid ? 'private_address' : 'unauthorized'
    response
      .writeHead(valid ? 400 : 401, {
        'content-type': 'application/json',
        'x-lacuno-relay-error': error,
      })
      .end(JSON.stringify({ error }))
  })

  /** A request as the gateway forwards it: signed for the claims in `as`, else anonymous. */
  const call = async (
    target: string,
    {
      method = 'GET',
      body = '',
      headers = {},
      as,
    }: { method?: string; body?: string; headers?: Record<string, string>; as?: object } = {},
  ) =>
    server.app.request(origin + target, {
      method,
      headers: as
        ? { ...headers, 'x-lacuno-assertion': await assertion(target, method, body, { ...as }) }
        : headers,
      ...(body ? { body } : {}),
    })
  const authorizeURL = (client_id: string, redirect_uri: string, verifier: string) =>
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: 'code',
      client_id,
      redirect_uri,
      scope: 'site offline_access',
      state: 'state-1',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource,
    })}`
  /** Authorizes an app as a Cloud user through the consent page's calls, then exchanges the code. */
  async function connect(client_id: string, redirect_uri: string, as: object = {}) {
    const verifier = randomBytes(32).toString('base64url')
    const consent = (
      await call(authorizeURL(client_id, redirect_uri, verifier), { as })
    ).headers.get('location')!
    expect(consent).toMatch(/^\/consent\?/)
    const client = `/api/auth/oauth2/public-client?client_id=${encodeURIComponent(client_id)}`
    expect((await (await call(client, { as })).json()).client_id).toBe(client_id)
    const body = JSON.stringify({ accept: true, oauth_query: consent.slice('/consent?'.length) })
    const answer = await call('/api/auth/oauth2/consent', {
      method: 'POST',
      body,
      headers: json,
      as,
    })
    expect(answer.status, await answer.clone().text()).toBe(200)
    const callback = new URL(((await answer.json()) as { url: string }).url)
    expect(callback.searchParams.get('iss')).toBe(`${origin}/api/auth`)
    const token = await call('/api/auth/oauth2/token', {
      method: 'POST',
      headers: form,
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: callback.searchParams.get('code')!,
        redirect_uri,
        code_verifier: verifier,
        client_id,
        resource,
      }).toString(),
    })
    expect(token.status, await token.clone().text()).toBe(200)
    return ((await token.json()) as { access_token: string }).access_token
  }
  const register = (ip: string) =>
    call('/api/auth/oauth2/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lacuno-client-ip': ip },
      body: JSON.stringify({
        client_name: 'Claude Code',
        redirect_uris: ['http://127.0.0.1/callback'],
        token_endpoint_auth_method: 'none',
      }),
    })

  beforeAll(async () => {
    relay.listen(0, '127.0.0.1')
    await once(relay, 'listening')
    dir = await mkdtemp(path.join(os.tmpdir(), 'lacuno-gateway-connect-'))
    server = await createServer({
      ...settings(dir),
      cimdRelay: `http://127.0.0.1:${(relay.address() as AddressInfo).port}/cimd`,
      publishBaseURL: 'http://sites.localhost',
    })
    const body = JSON.stringify({ name: 'Acme' })
    siteId = (
      await (await call('/api/sites', { method: 'POST', body, headers: json, as: {} })).json()
    ).id
    resource = `${origin}/mcp/${siteId}`
  })
  afterAll(async () => {
    server.close()
    relay.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('connects a registered app for a Cloud user, until Cloud revokes the user', async () => {
    // An app starts at the MCP address; the challenge names the public origin, not the address
    // the gateway forwarded to.
    const challenge = await server.app.request(`http://10.0.0.7:3000/mcp/${siteId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(challenge.status).toBe(401)
    expect(challenge.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp/${siteId}"`,
    )
    const protectedResource = await call(`/.well-known/oauth-protected-resource/mcp/${siteId}`)
    expect(await protectedResource.json()).toMatchObject({
      resource,
      authorization_servers: [`${origin}/api/auth`],
    })
    const metadata = await (await call('/.well-known/oauth-authorization-server/api/auth')).json()
    expect(metadata).toMatchObject({
      issuer: `${origin}/api/auth`,
      authorization_endpoint: `${origin}/api/auth/oauth2/authorize`,
      client_id_metadata_document_supported: true,
    })

    const registered = await register('198.51.100.1')
    expect(registered.status, await registered.clone().text()).toBe(201)
    const { client_id } = (await registered.json()) as { client_id: string }
    const token = await connect(client_id, 'http://127.0.0.1:43123/callback')

    const client = new Client({ name: 'Test Agent', version: '1.0.0' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
        fetch: async (url, init) => server.app.request(url, init),
      }) as Transport,
    )
    const read = await client.callTool({ name: 'document.read', arguments: {} })
    expect(read.isError).not.toBe(true)
    const sessionId = (client.transport as StreamableHTTPClientTransport).sessionId!

    // Only Cloud's own assertion revokes, and it is good for nothing else.
    const body = JSON.stringify({ userId: 'cloud-user-1' })
    const revoke = (as: object, payload = body) =>
      call('/api/gateway/revoke-user', {
        method: 'POST',
        body: payload,
        headers: { 'content-type': 'application/json' },
        as,
      })
    expect((await revoke({})).status).toBe(403)
    expect((await revoke(system, '{"user":"cloud-user-1"}')).status).toBe(400)
    expect((await call('/api/sites', { as: system })).status).toBe(401)
    const revoked = await revoke(system)
    expect(await revoked.json()).toEqual({ consents: 1, tokens: 2, sessions: 1 })
    expect(await (await revoke(system)).json()).toEqual({ consents: 0, tokens: 0, sessions: 0 })
    const call9 = await call(`/mcp/${siteId}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'mcp-session-id': sessionId,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'document.read', arguments: {} },
      }),
    })
    expect(call9.status).toBe(401)
  })

  it('offers publishing only to AI apps the owner approved, and viewers approve none', async () => {
    const registered = await register('198.51.100.4')
    const { client_id } = (await registered.json()) as { client_id: string }
    const redirect = 'http://127.0.0.1:43125/callback'
    const tools = async (as: object) => {
      const token = await connect(client_id, redirect, as)
      const client = new Client({ name: 'Test Agent', version: '1.0.0' })
      await client.connect(
        new StreamableHTTPClientTransport(new URL(resource), {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
          fetch: async (url, init) => server.app.request(url, init),
        }) as Transport,
      )
      const names = (await client.listTools()).tools.map((tool) => tool.name)
      await client.close()
      return names
    }
    expect(await tools({ sub: 'cloud-owner-4', role: 'owner' })).toContain('site.publish')
    expect(await tools({ sub: 'cloud-editor-4', role: 'editor' })).not.toContain('site.publish')
    const viewer = await call(authorizeURL(client_id, redirect, 'verifier'), {
      as: { sub: 'cloud-viewer-4', role: 'viewer' },
    })
    expect(viewer.status).toBe(403)
    // Revoking a user forgets their role: their next connection needs a fresh assertion of it.
    const sqlite = new Database(path.join(dir, 'lacuno.sqlite'), { readonly: true })
    const role = (user: string) =>
      sqlite.prepare('SELECT role FROM gateway_role WHERE user_id = ?').get(user)
    try {
      expect(role('cloud-editor-4')).toEqual({ role: 'editor' })
      const body = JSON.stringify({ userId: 'cloud-editor-4' })
      const revoked = await call('/api/gateway/revoke-user', {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
        as: {
          sub: 'lacuno-cloud',
          name: 'Lacuno Cloud',
          email: 'system@lacuno.invalid',
          system: true,
        },
      })
      expect(revoked.status).toBe(200)
      expect(role('cloud-editor-4')).toBeUndefined()
      expect(role('lacuno-cloud')).toBeUndefined()
    } finally {
      sqlite.close()
    }
  })

  it('names who connected each AI app, and lets editors disconnect only their own', async () => {
    const registered = await register('198.51.100.5')
    const { client_id } = (await registered.json()) as { client_id: string }
    const redirect = 'http://127.0.0.1:43126/callback'
    const owner = { sub: 'cloud-owner-5', name: 'Olga Owner', role: 'owner' }
    const editor = { sub: 'cloud-editor-5', name: 'Anna', role: 'editor' }
    const session = async (as: object) => {
      const token = await connect(client_id, redirect, as)
      const client = new Client({ name: 'Claude Code', version: '1.0.0' })
      await client.connect(
        new StreamableHTTPClientTransport(new URL(resource), {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
          fetch: async (url, init) => server.app.request(url, init),
        }) as Transport,
      )
      return client
    }
    const ownerApp = await session(owner)
    const editorApp = await session(editor)

    // The editor's app downloads a file through the relay, which it asks for each redirect.
    const events: SiteEvent[] = []
    const unsubscribe = siteEvents.subscribe(siteId, (event) => events.push(event))
    const imported = await editorApp.callTool({
      name: 'asset.import',
      arguments: { name: 'photo.png', url: 'https://images.example/photo' },
    })
    unsubscribe()
    expect(JSON.parse((imported.content as { text: string }[])[0]!.text)).toMatchObject({
      name: 'photo.png',
      mime: 'image/png',
      size: png.length,
    })
    expect(fileCalls).toEqual(['https://images.example/photo', 'https://images.example/photo.png'])
    expect(events).toEqual([
      expect.objectContaining({ actor: { kind: 'agent', app: 'Claude Code', user: 'Anna' } }),
    ])

    const list = async (as: object) =>
      (await (await call(`/api/sites/${siteId}/connections`, { as })).json()) as {
        id: string
        by: string
        mine: boolean
        active: boolean
      }[]
    const mine = (await list(editor)).filter((item) => ['Olga Owner', 'Anna'].includes(item.by))
    expect(mine).toEqual([
      expect.objectContaining({ by: 'Olga Owner', mine: false, active: true }),
      expect.objectContaining({ by: 'Anna', mine: true, active: true }),
    ])
    const [ownerConnection, editorConnection] = mine
    const disconnect = (id: string, as: object) =>
      call(`/api/sites/${siteId}/connections/${id}`, { method: 'DELETE', headers: json, as })
    expect((await disconnect(ownerConnection!.id, editor)).status).toBe(403)
    expect((await disconnect(editorConnection!.id, editor)).status).toBe(204)
    const read = (client: Client) => client.callTool({ name: 'document.read', arguments: {} })
    await expect(read(editorApp)).rejects.toThrow()
    expect((await read(ownerApp)).isError).not.toBe(true)
    // The owner disconnects anyone's.
    const again = await session(editor)
    const [renewed] = (await list(owner)).filter((item) => item.by === 'Anna')
    expect((await disconnect(renewed!.id, owner)).status).toBe(204)
    await expect(read(again)).rejects.toThrow()
    await ownerApp.close()
  })

  it('gives each Cloud user their own mirror row and consent', async () => {
    const registered = await register('198.51.100.2')
    const { client_id } = (await registered.json()) as { client_id: string }
    const redirect = 'http://127.0.0.1:43124/callback'
    await connect(client_id, redirect)
    await connect(client_id, redirect, { sub: 'cloud-user-2', name: 'Second user' })
    const sqlite = new Database(path.join(dir, 'lacuno.sqlite'), { readonly: true })
    try {
      expect(
        sqlite
          .prepare(
            'SELECT u.id, u.email FROM oauthConsent c JOIN user u ON u.id = c.userId WHERE c.clientId = ? ORDER BY u.id',
          )
          .all(client_id),
      ).toEqual([
        { id: 'cloud-user-1', email: 'cloud-user-1@gateway.invalid' },
        { id: 'cloud-user-2', email: 'cloud-user-2@gateway.invalid' },
      ])
    } finally {
      sqlite.close()
    }
  })

  it('resolves a Client ID Metadata Document through the relay', async () => {
    await connect(documentURL, 'https://app.example/callback', { sub: 'cloud-user-3' })
    expect(relayCalls).toEqual([{ url: documentURL, valid: true }])
    const refused = await call(
      authorizeURL(privateURL, 'https://internal.example/callback', 'verifier'),
      { as: { sub: 'cloud-user-3' } },
    )
    expect(refused.status).toBe(400)
    expect(await refused.json()).toMatchObject({ error: 'invalid_client' })
    expect(relayCalls.at(-1)).toEqual({ url: privateURL, valid: true })
  })

  it('keeps every other auth route closed and consent same-origin', async () => {
    for (const target of ['/api/auth/sign-in/email', '/api/auth/oauth2/introspect']) {
      expect((await call(target, { method: 'POST', body: '{}', headers: json })).status).toBe(401)
      const signed = await call(target, { method: 'POST', body: '{}', headers: json, as: {} })
      expect(signed.status).toBe(403)
    }
    expect((await call('/api/sites')).status).toBe(401)
    const consent = await call('/api/auth/oauth2/consent', {
      method: 'POST',
      body: JSON.stringify({ accept: true, oauth_query: 'x=1' }),
      headers: { ...json, origin: 'https://attacker.example' },
      as: {},
    })
    expect(consent.status).toBe(403)
  })

  it('rate-limits registration per client address', async () => {
    for (let i = 0; i < 5; i++) expect((await register('203.0.113.7')).status).toBe(201)
    expect((await register('203.0.113.7')).status).toBe(429)
    expect((await register('203.0.113.8')).status).toBe(201)
  })
})
