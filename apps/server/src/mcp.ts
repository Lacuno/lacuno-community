import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { DocumentStore } from '@lacuno/document'
import { createServer } from '@lacuno/mcp'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { type siteEvents, summarize } from './events.js'
import type { OAuth } from './oauth.js'
import type { Releases } from './releases.js'

export type McpDeps = {
  store: (siteId: string) => Promise<DocumentStore>
  dataDir: string
  oauth: OAuth
  events: typeof siteEvents
  /** Absent when publishing is not configured; `site.publish` is then not offered. */
  releases: Releases | undefined
}

type Session = {
  siteId: string
  connectionId: string
  /** The client's name from the MCP `initialize` handshake, until then the approved app name. */
  app: string
  /** The site's store as of the current request; a store holds the snapshot it loaded. */
  store: DocumentStore
  transport: WebStandardStreamableHTTPServerTransport
  expiry?: ReturnType<typeof setTimeout>
}

const IDLE_MS = 30 * 60_000
const PUBLISH_MS = 120_000
const sessions = new Map<string, Session>()

/** Connection ids with an open MCP session on this site. */
export function activeConnections(siteId: string): Set<string> {
  return new Set(
    [...sessions.values()].filter((s) => s.siteId === siteId).map((s) => s.connectionId),
  )
}

/** Closes every open session of one connection, after its tokens were revoked. */
export async function closeSessions(siteId: string, connectionId: string) {
  for (const s of [...sessions.values()])
    if (s.siteId === siteId && s.connectionId === connectionId) await s.transport.close()
}

/** Publishes the site's saved draft to testing and waits for the build; resolves to its URL. */
async function publishTesting(releases: Releases, siteId: string, revision: number, name?: string) {
  const { id } = releases.publish(
    siteId,
    revision,
    releases.current(siteId, 'testing'),
    name ?? null,
    'testing',
  )
  for (const deadline = Date.now() + PUBLISH_MS; Date.now() < deadline; await sleep(500)) {
    const release = releases.list(siteId).releases.find((r) => r.id === id)
    if (release?.status === 'ready') return { url: releases.url(siteId, 'testing') }
    if (release?.status === 'failed') throw new Error(release.error ?? 'The build failed.')
  }
  throw new Error('The build is still running. Check the testing address later.')
}

/** MCP Streamable HTTP at `/:id`, one transport and server per session, behind OAuth. */
export function mcpRoutes(deps: McpDeps): Hono {
  const app = new Hono()
  // Inline asset data is base64: 20 MB of bytes is about 27 MB of text.
  app.use(bodyLimit({ maxSize: 30 * 1024 * 1024 }))
  app.on(['GET', 'POST', 'DELETE'], '/:id', async (c) => {
    const siteId = c.req.param('id')
    const grant = await deps.oauth.verify(c.req.header('authorization'), siteId)
    if (!grant) {
      const metadata = `${new URL(c.req.url).origin}/.well-known/oauth-protected-resource/mcp/${siteId}`
      c.header('WWW-Authenticate', `Bearer resource_metadata="${metadata}"`)
      return c.json({ error: 'Authentication required' }, 401)
    }
    // Parsed once here, so a tool call can be recorded; the transport takes it as parsedBody.
    const body: unknown =
      c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined
    const sessionId = c.req.header('mcp-session-id')
    let session = sessionId ? sessions.get(sessionId) : undefined
    if (sessionId && (session?.siteId !== siteId || session.connectionId !== grant.clientId))
      return c.json({ error: 'Session not found' }, 404)
    if (!session && !isInitializeRequest(body))
      return c.json({ error: 'Initialize a session first' }, 400)
    // Reloaded per request, so the session sees the editor's saves since its last call.
    const store = await deps.store(siteId)
    if (!session) {
      const { releases } = deps
      const created: Session = {
        siteId,
        connectionId: grant.clientId,
        app: grant.app,
        store,
        transport: new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: randomUUID,
          onsessioninitialized: (id) => {
            sessions.set(id, created)
          },
        }),
      }
      created.transport.onclose = () => {
        clearTimeout(created.expiry)
        if (created.transport.sessionId) sessions.delete(created.transport.sessionId)
      }
      const live = new Proxy(store, {
        get: (_, key) => {
          const value = Reflect.get(created.store, key)
          return typeof value === 'function' ? value.bind(created.store) : value
        },
      })
      const server = createServer(live, {
        assets: (hash) =>
          readFile(path.join(deps.dataDir, 'sites', siteId, 'assets', hash)).catch(() => undefined),
        onApply: (batch, result) =>
          deps.events.emit(siteId, {
            revision: result.revision,
            patches: result.patches,
            actor: { kind: 'agent', app: created.app },
            at: Date.now(),
            summary: summarize(batch.operations, result.patches),
          }),
        ...(releases && {
          publish: (name) => publishTesting(releases, siteId, created.store.revision, name),
        }),
      })
      server.server.oninitialized = () => {
        const client = server.server.getClientVersion()
        if (client) created.app = client.title ?? client.name
      }
      await server.connect(created.transport)
      session = created
    }
    const current = session
    current.store = store
    clearTimeout(current.expiry)
    current.expiry = setTimeout(() => void current.transport.close(), IDLE_MS)
    current.expiry.unref()
    if ((body as { method?: unknown } | undefined)?.method === 'tools/call')
      deps.oauth.touch(current.connectionId)
    return current.transport.handleRequest(c.req.raw, { parsedBody: body })
  })
  return app
}
