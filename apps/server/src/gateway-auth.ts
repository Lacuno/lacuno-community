import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { type JWTPayload, jwtVerify, SignJWT } from 'jose'
import { z } from 'zod'
import { OwnerSetup } from './owner-setup.js'

export type GatewayOptions = { issuer: string; secret: string }

/** A 30-second HS256 token, signed with the gateway secret, for one of Cloud's internal services. */
export const signForCloud = (
  secret: string,
  issuer: string,
  audience: string,
  claims: JWTPayload,
) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('30s')
    .sign(new TextEncoder().encode(secret))
const Claims = z.object({
  sub: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  email: z.email(),
  jti: z.uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
  method: z.string(),
  target: z.string(),
  bodyHash: z.string(),
  /** Cloud's own requests, which only `revoke-user` accepts. */
  system: z.literal(true).optional(),
  /** The user's role in the workspace; without it, the owner's. */
  role: z.enum(['owner', 'editor', 'viewer']).optional(),
})
export type Role = 'owner' | 'editor' | 'viewer'

/**
 * Why a role refuses a request, or undefined: viewers read and approve no AI app, editors neither
 * publish nor roll back.
 */
export function refusal(role: Role, method: string, path: string) {
  const read = method === 'GET' || method === 'HEAD'
  if (role === 'viewer' && (!read || /^\/(consent|api\/auth\/oauth2)(\/|$)/.test(path)))
    return 'Viewers can look but not change anything'
  if (role === 'editor' && !read && /^\/api\/sites\/[^/]+\/releases(\/|$)/.test(path))
    return 'Only the workspace owner can publish'
}

/** Generic opt-in authenticated reverse-proxy mode. No browser assertion or cookie is trusted. */
export class GatewayAuth {
  readonly ownerId = 'lacuno-gateway-owner'
  constructor(
    private sqlite: Database.Database,
    private options: GatewayOptions,
    private audience: string,
  ) {
    if (options.secret.length < 32)
      throw new Error('Gateway secret must contain at least 32 characters')
    if (new URL(options.issuer).origin !== options.issuer)
      throw new Error('Gateway issuer must be an origin')
    sqlite
      .transaction(() => {
        const prior = sqlite.prepare('SELECT issuer,audience FROM gateway_mode WHERE id=1').get() as
          | { issuer: string; audience: string }
          | undefined
        if (prior && (prior.issuer !== options.issuer || prior.audience !== audience))
          throw new Error('Gateway identity cannot change for an existing instance')
        if (!prior) {
          if (sqlite.prepare('SELECT id FROM user LIMIT 1').get())
            throw new Error('Gateway mode requires an instance without local accounts')
          sqlite
            .prepare('INSERT INTO gateway_mode(id,issuer,audience) VALUES(1,?,?)')
            .run(options.issuer, audience)
          OwnerSetup.disable(sqlite)
          sqlite
            .prepare(
              'INSERT INTO user(id,name,email,"emailVerified","createdAt","updatedAt") VALUES(?,?,?,0,?,?)',
            )
            .run(
              this.ownerId,
              'Managed workspace',
              'gateway-owner@instance.invalid',
              Date.now(),
              Date.now(),
            )
        }
      })
      .immediate()
  }

  async authenticate(request: Request) {
    const assertion = request.headers.get('x-lacuno-assertion')
    if (!assertion || assertion.length > 8192) throw new Error('Missing gateway assertion')
    const { payload } = await jwtVerify(assertion, new TextEncoder().encode(this.options.secret), {
      algorithms: ['HS256'],
      issuer: this.options.issuer,
      audience: this.audience,
      maxTokenAge: 30,
    })
    const claims = Claims.parse(payload)
    const now = Math.floor(Date.now() / 1000)
    const url = new URL(request.url)
    if (
      claims.exp > claims.iat + 30 ||
      claims.method !== request.method ||
      claims.target !== url.pathname + url.search ||
      claims.bodyHash !==
        createHash('sha256')
          .update(Buffer.from(await request.clone().arrayBuffer()))
          .digest('hex')
    )
      throw new Error('Invalid gateway request binding')
    rememberNonce(this.sqlite, claims.jti, claims.exp, now)
    const role = claims.role ?? 'owner'
    // The role as last asserted: an MCP request carries a token, not an assertion.
    if (!claims.system)
      this.sqlite
        .prepare(
          'INSERT INTO gateway_role(user_id,role) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role',
        )
        .run(claims.sub, role)
    return { id: claims.sub, name: claims.name, email: claims.email, role, system: claims.system }
  }

  /** A user's role as their last assertion said, if the gateway has not revoked them since. */
  role(userId: string) {
    return (
      this.sqlite.prepare('SELECT role FROM gateway_role WHERE user_id=?').get(userId) as
        | { role: Role }
        | undefined
    )?.role
  }

  forget(userId: string) {
    this.sqlite.prepare('DELETE FROM gateway_role WHERE user_id=?').run(userId)
  }
}

function rememberNonce(sqlite: Database.Database, id: string, expires: number, now: number) {
  sqlite
    .transaction(() => {
      sqlite.prepare('DELETE FROM gateway_nonce WHERE expires_at <= ?').run(now)
      // The primary key provides replay protection across processes sharing this runtime database.
      sqlite.prepare('INSERT INTO gateway_nonce(id,expires_at) VALUES(?,?)').run(id, expires)
    })
    .immediate()
}
