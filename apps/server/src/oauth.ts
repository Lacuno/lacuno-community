import type { BetterAuthOptions } from 'better-auth'
import type Database from 'better-sqlite3'

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

/** Better Auth plugins that make this server an OAuth authorization server for its MCP endpoint. */
export function oauthPlugins(): NonNullable<BetterAuthOptions['plugins']> {
  return []
}

// STUB: the OAuth stream replaces this with the real implementation, keeping the signatures.
export function createOAuth(_auth: unknown, _sqlite: Database.Database, _origin: string): OAuth {
  return {
    verify: async () => null,
    connections: () => [],
    revoke: async () => false,
    touch: () => {},
  }
}
