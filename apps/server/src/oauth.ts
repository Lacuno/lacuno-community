import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { createCimdClientDiscovery } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import {
  type ClientMetadataResourceFetch,
  getOAuthProviderApi,
  getOAuthProviderState,
  type OAuthOptions,
  oauthProvider,
  type Scope,
} from '@better-auth/oauth-provider'
import type { AuthContext, BetterAuthOptions, BetterAuthPlugin, Session, User } from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type Database from 'better-sqlite3'
import { Hono } from 'hono'
import { type GatewayOptions, signForCloud } from './gateway-auth.js'

/** What a valid bearer token grants: one user, one site, from one registered app. */
export type Verified = {
  userId: string
  siteId: string
  clientId: string
  /** The consent behind the token: the connection the editor lists. */
  connectionId: string
  app: string
  /** In gateway mode, the name of the person who connected the app. */
  user?: string | undefined
}

/** A consent a user gave an app for a site, as the connect panel lists it. */
export type Connection = {
  id: string
  app: string
  clientId: string
  /** Who connected the app. */
  userId: string
  /** Their name, in gateway mode, where several people connect apps to one site. */
  by?: string | undefined
  approvedAt: number
  lastActiveAt: number | null
}

export type OAuth = {
  /** The grant behind an `Authorization` header for this site, or null when it is not valid. */
  verify(authorization: string | undefined, siteId: string): Promise<Verified | null>
  connections(siteId: string): Connection[]
  /** Revoke one connection and its tokens. */
  revoke(siteId: string, connection: Connection): Promise<void>
  /** Record that a connection acted, for `lastActiveAt`. */
  touch(id: string): void
}

/**
 * The scope every token carries. Better Auth only accepts scopes from a fixed list, so the site a
 * token grants is its audience instead: the RFC 8707 resource `<origin>/mcp/<site>`.
 */
export const SCOPE = 'site'

/** The site in a `/mcp/<site>` resource indicator. */
const siteOf = (resource: string | null) =>
  resource ? /^\/mcp\/([^/]+)$/.exec(new URL(resource).pathname)?.[1] : undefined

/** The user the gateway verified for the OAuth request being handled, in gateway mode. */
export const gatewayUser = new AsyncLocalStorage<{ id: string; name: string; email: string }>()

/** Marks the one session row per user that holds its connections; no browser ever holds it. */
const ANCHOR = 'lacuno-connections'
const YEAR = 365 * 24 * 60 * 60 * 1000

/** Upserts the local row of a gateway user, which their consents and tokens belong to. */
async function mirror(adapter: AuthContext['adapter'], { id, name }: { id: string; name: string }) {
  const now = new Date()
  return (
    (await adapter.update<User>({
      model: 'user',
      where: [{ field: 'id', value: id }],
      update: { name, updatedAt: now },
    })) ??
    adapter.create<Record<string, unknown>, User>({
      model: 'user',
      forceAllowId: true,
      data: {
        id,
        name,
        email: `${id}@gateway.invalid`,
        emailVerified: false,
        createdAt: now,
        updatedAt: now,
      },
    })
  )
}

/** The user's anchor session, created or extended by a year. */
async function anchor(adapter: AuthContext['adapter'], userId: string) {
  const now = new Date()
  const update = { expiresAt: new Date(now.getTime() + YEAR), updatedAt: now }
  return (
    (await adapter.update<Session>({
      model: 'session',
      where: [
        { field: 'userId', value: userId },
        { field: 'userAgent', value: ANCHOR },
      ],
      update,
    })) ??
    adapter.create<Record<string, unknown>, Session>({
      model: 'session',
      data: {
        ...update,
        userId,
        userAgent: ANCHOR,
        token: randomBytes(32).toString('base64url'),
        createdAt: now,
      },
    })
  )
}

/**
 * Fetches through Cloud's relay, as a gateway runtime has no internet access: Client ID Metadata
 * Documents (`lacuno-cimd-relay`) or an AI app's files (`lacuno-file-relay`). A relay refusal
 * throws its code, like the Node fetcher throws for a private address.
 */
export function relayFetch(
  relay: string,
  secret: string,
  issuer: string,
  audience: 'lacuno-cimd-relay' | 'lacuno-file-relay',
): ClientMetadataResourceFetch {
  return async (input, init) => {
    const url = String(input)
    const token = await signForCloud(secret, issuer, audience, { url })
    const response = await fetch(relay, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ url }),
      // A redirect the relay passes on is the caller's to check, never followed here.
      redirect: 'manual',
      signal: init?.signal ?? null,
    })
    const refused = response.headers.get('x-lacuno-relay-error')
    if (refused) throw new TypeError(refused)
    return response
  }
}

/** Better Auth plugins that make this server an OAuth authorization server for its MCP endpoint. */
export function oauthPlugins({
  origin,
  gateway,
  cimdRelay,
}: {
  origin: string
  gateway?: GatewayOptions | undefined
  cimdRelay?: string | undefined
}): NonNullable<BetterAuthOptions['plugins']> {
  // A gateway runtime reaches the internet only through the relay; without one it offers
  // registration alone.
  const fetchMetadata = !gateway
    ? fetchClientMetadataResource
    : cimdRelay && relayFetch(cimdRelay, gateway.secret, origin, 'lacuno-cimd-relay')
  return [
    // Cast: its endpoint types trip exactOptionalPropertyTypes against BetterAuthPlugin.
    oauthProvider({
      scopes: [SCOPE, 'offline_access'],
      grantTypes: ['authorization_code', 'refresh_token'],
      // The editor's consent screen signs the user in first when needed.
      loginPage: '/consent',
      consentPage: '/consent',
      disableJwtPlugin: true,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Every site's resource is open to every client; the consent and the owner check guard it.
      enforcePerClientResources: false,
      // Client ID Metadata Documents, which MCP prefers over registration.
      extensions: fetchMetadata
        ? [
            {
              clientDiscovery: createCimdClientDiscovery({
                fetchClientMetadataResource: fetchMetadata,
                metadataProfile: 'mcp-2026-07-28',
              }),
            },
          ]
        : [],
      // One consent per app and site, keyed by the site the request names.
      postLogin: {
        page: '/consent',
        shouldRedirect: () => false,
        consentReferenceId: async () => {
          const site = siteOf(
            new URLSearchParams((await getOAuthProviderState())?.query).get('resource'),
          )
          if (!site)
            throw new APIError('BAD_REQUEST', {
              error: 'invalid_target',
              error_description: 'Connect through a site’s MCP address.',
            })
          return site
        },
      },
    }) as BetterAuthPlugin,
    {
      id: 'lacuno-oauth',
      hooks: {
        before: [
          {
            // Apps that register themselves are desktop and CLI apps, which redirect to loopback.
            matcher: (ctx) => ctx.path === '/oauth2/register',
            handler: createAuthMiddleware(async (ctx) => ({
              context: { body: { application_type: 'native', ...ctx.body } },
            })),
          },
          {
            // Tokens hang off a session row, so each user's connections hang off an anchor session
            // instead of the browser's: signing out does not end them. In gateway mode the user is
            // the gateway's, mirrored into a local row.
            matcher: (ctx) =>
              ['/oauth2/authorize', '/oauth2/consent', '/oauth2/public-client'].includes(
                ctx.path ?? '',
              ),
            handler: createAuthMiddleware(async (ctx) => {
              const { adapter } = ctx.context
              const verified = gatewayUser.getStore()
              const user = gateway
                ? verified && (await mirror(adapter, verified))
                : (await getSessionFromCtx(ctx))?.user
              if (user) ctx.context.session = { session: await anchor(adapter, user.id), user }
            }),
          },
        ],
      },
    } satisfies BetterAuthPlugin,
  ]
}

export function createOAuth(
  auth: { $context: Promise<unknown>; handler: (request: Request) => Promise<Response> },
  sqlite: Database.Database,
  origin: string,
  { gateway }: { gateway: boolean },
): OAuth & {
  routes: Hono
  /** Ends every connection a gateway user approved; resolves to what it revoked. */
  revokeUser(userId: string): Promise<{ consents: number; tokens: number }>
} {
  const context = auth.$context as Promise<AuthContext>
  const issuer = `${origin}/api/auth`
  const resourceOf = (siteId: string) => `${origin}/mcp/${siteId}`
  const lastActive = new Map<string, number>()
  const site = sqlite.prepare<[string], { name: string; ownerId: string }>(
    'SELECT s.name, w.owner_id AS ownerId FROM sites s JOIN workspaces w ON w.id = s.workspace_id WHERE s.id = ?',
  )
  const app = sqlite.prepare<[string], { name: string | null }>(
    'SELECT name FROM oauthClient WHERE clientId = ?',
  )
  const consents = sqlite.prepare<
    [string],
    {
      id: string
      app: string | null
      clientId: string
      userId: string
      by: string
      approvedAt: string
    }
  >(
    'SELECT c.id, k.name AS app, c.clientId, c.userId, u.name AS by, c.createdAt AS approvedAt FROM oauthConsent c JOIN oauthClient k ON k.clientId = c.clientId JOIN user u ON u.id = c.userId WHERE c.referenceId = ?',
  )
  const consent = sqlite.prepare<[string, string, string], { id: string; by: string }>(
    'SELECT c.id, u.name AS by FROM oauthConsent c JOIN user u ON u.id = c.userId WHERE c.clientId = ? AND c.userId = ? AND c.referenceId = ?',
  )

  const routes = new Hono()
  // RFC 8414 at the root and path-inserted for the issuer's /api/auth path, as MCP clients try both.
  for (const path of ['/oauth-authorization-server', '/oauth-authorization-server/api/auth'])
    routes.get(path, () =>
      auth.handler(new Request(`${origin}/.well-known/oauth-authorization-server/api/auth`)),
    )
  routes.get('/oauth-protected-resource/mcp/:id', async (c) => {
    const found = site.get(c.req.param('id'))
    if (!found) return c.json({ error: 'Site not found' }, 404)
    const resource = resourceOf(c.req.param('id'))
    // Better Auth issues tokens only for resources it knows, so each site's is created on discovery.
    const { adapter } = await context
    const where = [{ field: 'identifier', value: resource }]
    if (!(await adapter.findOne({ model: 'oauthResource', where })))
      await adapter.create({
        model: 'oauthResource',
        data: { identifier: resource, name: found.name },
      })
    return c.json({
      resource,
      authorization_servers: [issuer],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
    })
  })

  return {
    routes,
    async verify(authorization, siteId) {
      const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1]
      if (!token) return null
      const ctx = { context: await context }
      const { options } = ctx.context.getPlugin('oauth-provider') as {
        options: OAuthOptions<Scope[]>
      }
      const provider = getOAuthProviderApi(ctx as never, options)
      // Unknown tokens throw; expired and revoked ones come back inactive.
      const payload = await (async () => provider.validateAccessToken(token))().catch(() => null)
      const found = site.get(siteId)
      if (
        !payload?.active ||
        payload.aud !== resourceOf(siteId) ||
        !String(payload.scope).split(' ').includes(SCOPE) ||
        // A sub means the token's user row exists. Every gateway user edits every site.
        !payload.sub ||
        !found ||
        (!gateway && found.ownerId !== payload.sub)
      )
        return null
      const clientId = String(payload.client_id)
      // The consent is the connection the editor lists; without it the token grants nothing.
      const connection = consent.get(clientId, payload.sub, siteId)
      if (!connection) return null
      return {
        userId: payload.sub,
        siteId,
        clientId,
        connectionId: connection.id,
        app: app.get(clientId)?.name ?? clientId,
        user: gateway ? connection.by : undefined,
      }
    },
    connections: (siteId) =>
      consents.all(siteId).map(({ id, app, clientId, userId, by, approvedAt }) => ({
        id,
        app: app ?? clientId,
        clientId,
        userId,
        by: gateway ? by : undefined,
        approvedAt: new Date(approvedAt).getTime(),
        lastActiveAt: lastActive.get(id) ?? null,
      })),
    async revoke(siteId, { id, clientId, userId }) {
      const { adapter } = await context
      await adapter.deleteMany({ model: 'oauthConsent', where: [{ field: 'id', value: id }] })
      const where = [
        { field: 'clientId', value: clientId },
        { field: 'referenceId', value: siteId },
        { field: 'userId', value: userId },
      ]
      for (const model of ['oauthAccessToken', 'oauthRefreshToken'])
        await adapter.updateMany({ model, where, update: { revoked: new Date() } })
      lastActive.delete(id)
    },
    touch: (id) => void lastActive.set(id, Date.now()),
    async revokeUser(userId) {
      const { adapter } = await context
      const where = [{ field: 'userId', value: userId }]
      const consents = await adapter.deleteMany({ model: 'oauthConsent', where })
      let tokens = 0
      for (const model of ['oauthAccessToken', 'oauthRefreshToken'])
        tokens += await adapter.updateMany({ model, where, update: { revoked: new Date() } })
      // The anchor session and the tokens go with the mirror row; only mirrors have this email.
      await adapter.deleteMany({
        model: 'user',
        where: [
          { field: 'id', value: userId },
          { field: 'email', value: `${userId}@gateway.invalid` },
        ],
      })
      return { consents, tokens }
    },
  }
}
