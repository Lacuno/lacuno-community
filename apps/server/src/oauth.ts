import { AsyncLocalStorage } from 'node:async_hooks'
import type { ClientMetadataResourceFetch } from '@better-auth/oauth-provider'
import type { AuthContext } from 'better-auth'
import type Database from 'better-sqlite3'
import { Hono } from 'hono'
import type { Auth } from './auth.js'
import { signForCloud } from './gateway-auth.js'

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

/** The user the gateway verified for the OAuth request being handled, in gateway mode. */
export const gatewayUser = new AsyncLocalStorage<{ id: string; name: string; email: string }>()

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

/** OAuth for the MCP endpoint, with Better Auth loaded on first use by `auth`. */
export function createOAuth(
  auth: () => Promise<Auth>,
  sqlite: Database.Database,
  origin: string,
  { gateway }: { gateway: boolean },
): OAuth & {
  routes: Hono
  /** Ends every connection a gateway user approved; resolves to what it revoked. */
  revokeUser(userId: string): Promise<{ consents: number; tokens: number }>
} {
  const context = async () => (await (await auth()).$context) as AuthContext
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
    routes.get(path, async () =>
      (await auth()).handler(
        new Request(`${origin}/.well-known/oauth-authorization-server/api/auth`),
      ),
    )
  routes.get('/oauth-protected-resource/mcp/:id', async (c) => {
    const found = site.get(c.req.param('id'))
    if (!found) return c.json({ error: 'Site not found' }, 404)
    const resource = resourceOf(c.req.param('id'))
    // Better Auth issues tokens only for resources it knows, so each site's is created on discovery.
    const { adapter } = await context()
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
      const { validateAccessToken } = await import('./auth.js')
      const payload = await validateAccessToken(await auth(), token).catch(() => null)
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
      const { adapter } = await context()
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
      const { adapter } = await context()
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
