import { createHash } from 'node:crypto'

/**
 * The origin a host gives a server's views: for Claude, the first 32 hex characters of the
 * SHA-256 of the connector URL under claudemcpcontent.com. Its own module, so the runtime's start
 * can name the origin it allows without loading the MCP SDK.
 */
export const viewDomain = (connectorUrl: string) =>
  `${createHash('sha256').update(connectorUrl).digest('hex').slice(0, 32)}.claudemcpcontent.com`
