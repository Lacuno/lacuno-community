import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { editor } from './harness.js'

it('connects an app to one site through registration, consent and a PKCE token exchange', async () => {
  const { server, origin, siteId, page, context, dir, api } = await editor()
  const request = (route: string, init?: RequestInit) => server.app.request(origin + route, init)
  const resource = `${origin}/mcp/${siteId}`
  const issuer = `${origin}/api/auth`

  // Discovery: the site's protected resource names this server's issuer.
  expect(
    await (await request(`/.well-known/oauth-protected-resource/mcp/${siteId}`)).json(),
  ).toEqual({
    resource,
    authorization_servers: [issuer],
    scopes_supported: ['site'],
    bearer_methods_supported: ['header'],
  })
  expect((await request('/.well-known/oauth-protected-resource/mcp/missing')).status).toBe(404)
  for (const route of ['', '/api/auth']) {
    const metadata = await (await request(`/.well-known/oauth-authorization-server${route}`)).json()
    expect(metadata).toMatchObject({
      issuer,
      registration_endpoint: `${issuer}/oauth2/register`,
      code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
    })
    expect(metadata.token_endpoint_auth_methods_supported).toContain('none')
  }

  // Dynamic registration of a CLI app with a portless loopback redirect.
  const registered = await request('/api/auth/oauth2/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude Code',
      redirect_uris: ['http://127.0.0.1/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    }),
  })
  expect(registered.status, await registered.clone().text()).toBe(201)
  const { client_id } = (await registered.json()) as { client_id: string }

  // The authorization request, on an ephemeral port, lands on the editor's consent page.
  const verifier = randomBytes(32).toString('base64url')
  const redirect = 'http://127.0.0.1:43123/callback'
  const authorizeURL = (client: string, redirect_uri: string) =>
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: 'code',
      client_id: client,
      redirect_uri,
      scope: 'site offline_access',
      state: 'state-1',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource,
    })}`
  const authorize = authorizeURL(client_id, redirect)
  const cookie = (await context.cookies()).map((item) => `${item.name}=${item.value}`).join('; ')
  const consent = (await request(authorize, { headers: { cookie } })).headers.get('location')!
  expect(consent).toMatch(/^\/consent\?/)

  // The signed-in owner allows it and the app's loopback receives a code and the issuer.
  let callback: URL | undefined
  await context.route(`${redirect}**`, (route) => {
    callback = new URL(route.request().url())
    return route.fulfill({ body: 'done' })
  })
  await page.goto(origin + consent)
  await page.getByRole('heading', { name: 'Allow Claude Code to edit Test site?' }).waitFor()
  expect(await page.getByText(/You will return to/).count()).toBe(0)
  await page.getByRole('button', { name: 'Allow' }).click()
  await expect.poll(() => callback?.searchParams.get('state')).toBe('state-1')
  expect(callback!.searchParams.get('iss')).toBe(issuer)

  // Any app can call itself Claude; the consent page names the website a web app returns to.
  const web = await request('/api/auth/oauth2/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Claude',
      redirect_uris: ['https://app.example/callback'],
      token_endpoint_auth_method: 'none',
    }),
  })
  const webClient = ((await web.json()) as { client_id: string }).client_id
  const webAuthorize = authorizeURL(webClient, 'https://app.example/callback')
  await page.goto(
    origin + (await request(webAuthorize, { headers: { cookie } })).headers.get('location'),
  )
  await page.getByText('You will return to app.example.').waitFor()

  const token = async (body: Record<string, string>) => {
    const response = await request('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id, resource, ...body }),
    })
    expect(response.status, await response.clone().text()).toBe(200)
    return (await response.json()) as { access_token: string; refresh_token: string }
  }
  const granted = await token({
    grant_type: 'authorization_code',
    code: callback!.searchParams.get('code')!,
    redirect_uri: redirect,
    code_verifier: verifier,
  })
  const bearer = `Bearer ${granted.access_token}`

  // The token grants this site only, and only while its user owns it.
  const verified = {
    userId: expect.any(String),
    siteId,
    clientId: client_id,
    connectionId: expect.any(String),
    app: 'Claude Code',
  }
  expect(await server.oauth.verify(bearer, siteId)).toEqual(verified)
  const refreshed = await token({
    grant_type: 'refresh_token',
    refresh_token: granted.refresh_token,
  })
  expect(await server.oauth.verify(`Bearer ${refreshed.access_token}`, siteId)).toEqual(verified)
  const other = (await (await api('/api/sites', { name: 'Other site' })).json()) as { id: string }
  expect(await server.oauth.verify(bearer, other.id)).toBeNull()
  expect(await server.oauth.verify(undefined, siteId)).toBeNull()
  expect(await server.oauth.verify('Bearer nonsense', siteId)).toBeNull()

  const sqlite = new Database(path.join(dir, 'lacuno.sqlite'))
  const workspace = sqlite
    .prepare('SELECT workspace_id FROM sites WHERE id = ?')
    .pluck()
    .get(siteId)
  sqlite
    .prepare(
      "INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES ('other', 'Other', 'other@example.test', 0, 0, 0)",
    )
    .run()
  sqlite
    .prepare("INSERT INTO workspaces (id, owner_id, name) VALUES ('elsewhere', 'other', 'Other')")
    .run()
  const move = sqlite.prepare('UPDATE sites SET workspace_id = ? WHERE id = ?')
  move.run('elsewhere', siteId)
  expect(await server.oauth.verify(bearer, siteId)).toBeNull()
  move.run(workspace, siteId)
  expect(await server.oauth.verify(bearer, siteId)).toEqual(verified)

  // Tokens hang off the user's anchor session, which no browser holds and each authorization
  // extends, so signing out keeps the connection.
  const anchors = () =>
    sqlite
      .prepare("SELECT id, token, expiresAt FROM session WHERE userAgent = 'lacuno-connections'")
      .all() as { id: string; token: string; expiresAt: string }[]
  const [anchor] = anchors()
  expect(sqlite.prepare('SELECT DISTINCT sessionId FROM oauthAccessToken').pluck().all()).toEqual([
    anchor!.id,
  ])
  expect(cookie).not.toContain(anchor!.token)
  const again = (await request(authorize, { headers: { cookie } })).headers.get('location')!
  expect(new URL(again).searchParams.get('code')).toBeTruthy()
  const [extended, ...more] = anchors()
  expect(more).toEqual([])
  expect(extended!.id).toBe(anchor!.id)
  expect(new Date(extended!.expiresAt).getTime()).toBeGreaterThan(
    new Date(anchor!.expiresAt).getTime(),
  )
  const signOut = await request('/api/auth/sign-out', {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: '{}',
  })
  expect(signOut.status).toBe(200)
  expect((await api('/api/sites')).status).toBe(401)
  expect(await server.oauth.verify(bearer, siteId)).toEqual(verified)
  sqlite.close()

  // The connect panel lists the connection, the token's consent, until it is revoked, which
  // ends its tokens.
  const { connectionId, userId } = (await server.oauth.verify(bearer, siteId))!
  expect(server.oauth.connections(siteId)).toEqual([
    {
      id: connectionId,
      app: 'Claude Code',
      clientId: client_id,
      userId,
      approvedAt: expect.any(Number),
      lastActiveAt: null,
    },
  ])
  server.oauth.touch(connectionId)
  const [connection] = server.oauth.connections(siteId)
  expect(connection!.lastActiveAt).toBeGreaterThan(0)
  await server.oauth.revoke(siteId, connection!)
  expect(await server.oauth.verify(bearer, siteId)).toBeNull()
  expect(server.oauth.connections(siteId)).toEqual([])
})
