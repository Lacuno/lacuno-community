import type { DocumentStore } from '@freeflow/document'
import { Hono } from 'hono'
import type { siteEvents } from './events.js'
import type { OAuth } from './oauth.js'

export type McpDeps = {
  store: (siteId: string) => Promise<DocumentStore>
  oauth: OAuth
  events: typeof siteEvents
}

// STUB: the endpoint stream replaces this with the Streamable HTTP routes under /mcp/:id.
export function mcpRoutes(_deps: McpDeps): Hono {
  return new Hono()
}
