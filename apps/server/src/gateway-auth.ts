import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { type JWTPayload, jwtVerify, SignJWT } from 'jose'
import { z } from 'zod'
import { OwnerSetup } from './owner-setup.js'

/** `home` is the gateway's dashboard, where the editor's logo leads; the issuer when not given. */
export type GatewayOptions = { issuer: string; secret: string; home?: string }

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
  /** The workspace's name, which the editor shows. */
  workspace: z.string().min(1).max(200).optional(),
})
export type Role = 'owner' | 'editor' | 'viewer'
const EMPTY_BODY_HASH = createHash('sha256').digest('hex')

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
  /** Each user's role as this process last wrote it, so an unchanged role costs no write. */
  private roles = new Map<string, Role>()
  private nonceSweep = 0
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
    // The gateway hashes an empty body for a request without one.
    const bodyHash = request.body
      ? createHash('sha256')
          .update(Buffer.from(await request.clone().arrayBuffer()))
          .digest('hex')
      : EMPTY_BODY_HASH
    if (
      claims.exp > claims.iat + 30 ||
      claims.method !== request.method ||
      claims.target !== url.pathname + url.search ||
      claims.bodyHash !== bodyHash
    )
      throw new Error('Invalid gateway request binding')
    // Expired nonces go at most once a minute, not with every request.
    if (now - this.nonceSweep >= 60) {
      this.nonceSweep = now
      this.sqlite.prepare('DELETE FROM gateway_nonce WHERE expires_at <= ?').run(now)
    }
    // The primary key provides replay protection across processes sharing this runtime database.
    this.sqlite
      .prepare('INSERT INTO gateway_nonce(id,expires_at) VALUES(?,?)')
      .run(claims.jti, claims.exp)
    const role = claims.role ?? 'owner'
    // The role as last asserted: an MCP request carries a token, not an assertion.
    if (!claims.system && this.roles.get(claims.sub) !== role) {
      this.sqlite
        .prepare(
          'INSERT INTO gateway_role(user_id,role) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role',
        )
        .run(claims.sub, role)
      this.roles.set(claims.sub, role)
    }
    return {
      id: claims.sub,
      name: claims.name,
      email: claims.email,
      role,
      workspace: claims.workspace,
      system: claims.system,
    }
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
    this.roles.delete(userId)
    this.sqlite.prepare('DELETE FROM gateway_role WHERE user_id=?').run(userId)
  }
}
