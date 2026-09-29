// Better Auth, loaded on first use: behind a gateway only AI apps' OAuth needs it, so a runtime
// that nobody connects an AI app to never loads it. Its migrations run in auth-migrate.ts's
// child process, whose memory leaves with it.
import { randomBytes } from 'node:crypto'
import { createCimdClientDiscovery } from '@better-auth/cimd'
import { fetchClientMetadataResource } from '@better-auth/cimd/node'
import {
  getOAuthProviderApi,
  getOAuthProviderState,
  type OAuthOptions,
  oauthProvider,
  type Scope,
} from '@better-auth/oauth-provider'
import {
  type AuthContext,
  type BetterAuthOptions,
  type BetterAuthPlugin,
  betterAuth,
  type Session,
  type User,
} from 'better-auth'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { getMigrations } from 'better-auth/db/migration'
import type Database from 'better-sqlite3'
import type { GatewayOptions } from './gateway-auth.js'
import { gatewayUser, relayFetch, SCOPE } from './oauth.js'

export type AuthSettings = {
  sqlite: Database.Database
  origin: string
  secret: string
  /** Whether email sign-up is open. */
  signUp: boolean
  gateway?: GatewayOptions | undefined
  cimdRelay?: string | undefined
}

export function authOptions({
  sqlite,
  origin,
  secret,
  signUp,
  gateway,
  cimdRelay,
}: AuthSettings): BetterAuthOptions {
  return {
    database: sqlite,
    baseURL: origin,
    secret,
    trustedOrigins: [origin],
    emailAndPassword: { enabled: true, disableSignUp: !signUp },
    rateLimit: { enabled: true, storage: 'database' },
    // Behind a gateway every request comes from the gateway; it names the client.
    ...(gateway ? { advanced: { ipAddress: { ipAddressHeaders: ['x-lacuno-client-ip'] } } } : {}),
    plugins: oauthPlugins({ origin, gateway, cimdRelay }),
  }
}

export const createAuth = (settings: AuthSettings) => betterAuth(authOptions(settings))
export type Auth = ReturnType<typeof createAuth>

/** Creates and updates Better Auth's tables; the settings do not change them. */
export async function migrateAuth(sqlite: Database.Database) {
  const secret = randomBytes(32).toString('hex')
  const options = authOptions({ sqlite, origin: 'http://localhost', secret, signUp: false })
  await (await getMigrations(options)).runMigrations()
}

/** An access token's claims; unknown tokens throw, expired and revoked ones come back inactive. */
export async function validateAccessToken(auth: Auth, token: string) {
  const ctx = { context: (await auth.$context) as AuthContext }
  const { options } = ctx.context.getPlugin('oauth-provider') as {
    options: OAuthOptions<Scope[]>
  }
  return getOAuthProviderApi(ctx as never, options).validateAccessToken(token)
}

/** The site in a `/mcp/<site>` resource indicator. */
const siteOf = (resource: string | null) =>
  resource ? /^\/mcp\/([^/]+)$/.exec(new URL(resource).pathname)?.[1] : undefined

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

/** Better Auth plugins that make this server an OAuth authorization server for its MCP endpoint. */
function oauthPlugins({
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
