import { createCimdClientDiscovery } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import {
  getOAuthProviderApi,
  getOAuthProviderState,
  type OAuthOptions,
  oauthProvider,
  type Scope,
} from '@better-auth/oauth-provider'
import type { AuthContext, BetterAuthOptions, BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import type Database from 'better-sqlite3'
import { Hono } from 'hono'

/** What a valid bearer token grants: one user, one site, from one registered app. */
export type Verified = { userId: string; siteId: string; clientId: string; app: string }

/** A consent a user gave an app for a site, as the connect panel lists it. */
export type Connection = {
  id: string
  app: string
  approvedAt: number
  lastActiveAt: number | null
}

export type OAuth = {
  /** The grant behind an `Authorization` header for this site, or null when it is not valid. */
  verify(authorization: string | undefined, siteId: string): Promise<Verified | null>
  connections(siteId: string): Connection[]
  /** Revoke one connection's tokens; true when it existed. */
  revoke(siteId: string, id: string): Promise<boolean>
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

/** Better Auth plugins that make this server an OAuth authorization server for its MCP endpoint. */
export function oauthPlugins(): NonNullable<BetterAuthOptions['plugins']> {
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
      extensions: [
        {
          clientDiscovery: createCimdClientDiscovery({
            fetchClientMetadataResource,
            metadataProfile: 'mcp-2026-07-28',
          }),
        },
      ],
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
      id: 'miralo-oauth',
      hooks: {
        before: [
          {
            // Apps that register themselves are desktop and CLI apps, which redirect to loopback.
            matcher: (ctx) => ctx.path === '/oauth2/register',
            handler: createAuthMiddleware(async (ctx) => ({
              context: { body: { application_type: 'native', ...ctx.body } },
            })),
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
): OAuth & { routes: Hono } {
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
  const consents = sqlite.prepare<[string], { id: string; app: string | null; approvedAt: string }>(
    'SELECT c.clientId AS id, k.name AS app, c.createdAt AS approvedAt FROM oauthConsent c JOIN oauthClient k ON k.clientId = c.clientId WHERE c.referenceId = ?',
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
      if (
        !payload?.active ||
        payload.aud !== resourceOf(siteId) ||
        !String(payload.scope).split(' ').includes(SCOPE) ||
        !payload.sub ||
        site.get(siteId)?.ownerId !== payload.sub
      )
        return null
      const clientId = String(payload.client_id)
      return { userId: payload.sub, siteId, clientId, app: app.get(clientId)?.name ?? clientId }
    },
    connections: (siteId) =>
      consents.all(siteId).map(({ id, app, approvedAt }) => ({
        id,
        app: app ?? id,
        approvedAt: new Date(approvedAt).getTime(),
        lastActiveAt: lastActive.get(id) ?? null,
      })),
    async revoke(siteId, id) {
      const { adapter } = await context
      const where = [
        { field: 'clientId', value: id },
        { field: 'referenceId', value: siteId },
      ]
      const removed = await adapter.deleteMany({ model: 'oauthConsent', where })
      for (const model of ['oauthAccessToken', 'oauthRefreshToken'])
        await adapter.updateMany({ model, where, update: { revoked: new Date() } })
      lastActive.delete(id)
      return removed > 0
    },
    touch: (id) => void lastActive.set(id, Date.now()),
  }
}
