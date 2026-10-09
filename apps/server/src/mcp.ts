import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { IMAGE_WIDTHS } from '@lacuno/compiler'
import type { ApplyResult, Batch, DocumentStore, Operation, stageUpload } from '@lacuno/document'
import type { AssetDetails } from '@lacuno/mcp'
import type { Screenshot } from '@lacuno/mcp/screenshot'
import type { AssetRef } from '@lacuno/schema'
import type { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { type siteEvents, summarize } from './events.js'
import { imageVariant } from './images.js'
import type { OAuth, Verified } from './oauth.js'
import type { Releases } from './releases.js'

export type McpDeps = {
  store: (siteId: string) => Promise<DocumentStore>
  dataDir: string
  oauth: OAuth
  /**
   * Behind a gateway, the grant behind an `x-lacuno-assertion` instead of a bearer, for Cloud's
   * own client acting as the signed-in user. Like REST, each assertion binds one request: its
   * method, its target (`/mcp/<site>` plus any query) and the sha256 hex of its body, empty for
   * GET and DELETE.
   */
  assertion: ((request: Request, siteId: string) => Promise<Grant | undefined>) | undefined
  events: typeof siteEvents
  /** Absent when publishing is not configured; `site.publish` is then not offered. */
  releases: Releases | undefined
  /** Whether the user who approved a connection may publish, as its session starts. */
  canPublish: (userId: string) => boolean
  /** The public origin; behind a gateway the request URL is an internal address. */
  origin: string
  /** Checks and stores a file like an editor upload, returning the asset to register. */
  stage: (siteId: string, name: string, bytes: Uint8Array) => ReturnType<typeof stageUpload>
  /** Downloads an address for asset.import; absent where the runtime cannot reach the internet. */
  fetchUrl: ((url: string) => Promise<Uint8Array>) | undefined
  /** Tells Cloud what an AI app did, for the person who connected it; absent without Cloud. */
  report: ((siteId: string, activity: Activity) => void) | undefined
  /** Takes page.screenshot's images; absent where neither a screenshot service nor Playwright is. */
  screenshot: Screenshot | undefined
  /** Spike: offers editor.session and editor.open, minting a bearer for the grant's user. */
  editor:
    | {
        origin: string
        connectorUrl?: string
        mint: (grant: Grant, siteId: string) => { token: string; site: string; expiresAt: string }
      }
    | undefined
}

/** Who a request acts for: an OAuth grant or a gateway user assertion. */
export type Grant = Pick<Verified, 'userId' | 'connectionId' | 'app' | 'user'>

/** What an AI app did, reported for the person who connected it. */
export type Activity = { user: string; app: string; action: 'edited' | 'published' }

type Session = {
  siteId: string
  connectionId: string
  /** The user who approved the connection, and in gateway mode their name. */
  userId: string
  user: string | undefined
  /** The client's name from the MCP `initialize` handshake, until then the approved app name. */
  app: string
  /** The site's store, the same one the editor's requests use. */
  store: DocumentStore
  transport: WebStandardStreamableHTTPServerTransport
  expiry?: ReturnType<typeof setTimeout>
  /** When `edited` was last reported. */
  reported?: number
}

const IDLE_MS = 30 * 60_000
const PUBLISH_MS = 120_000
const UPLOAD_MS = 10 * 60_000
const HOUR = 60 * 60_000
const sessions = new Map<string, Session>()
/** Single-use upload addresses by token: the session that asked for one and the file's details. */
const uploads = new Map<string, { session: Session; details: AssetDetails; expires: number }>()

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

/** Closes every open session a user approved, after their access was revoked; resolves to the count. */
export async function closeUserSessions(userId: string) {
  const closing = [...sessions.values()].filter((s) => s.userId === userId)
  for (const s of closing) await s.transport.close()
  return closing.length
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

/** A batch an AI app committed: to the editor's live view, and to Cloud at most once an hour. */
function applied(deps: McpDeps, session: Session, batch: Batch, result: ApplyResult) {
  deps.events.emit(session.siteId, {
    revision: result.revision,
    patches: result.patches,
    actor: { kind: 'agent', app: session.app, ...(session.user && { user: session.user }) },
    at: Date.now(),
    summary: summarize(batch.operations, result.patches),
  })
  if (Date.now() - (session.reported ?? 0) < HOUR) return
  session.reported = Date.now()
  deps.report?.(session.siteId, { user: session.userId, app: session.app, action: 'edited' })
}

/** Checks an AI app's file like an editor upload, stores it and registers it in one batch. */
async function importFile(
  deps: McpDeps,
  session: Session,
  store: DocumentStore,
  { bytes, ...details }: AssetDetails & { bytes: Uint8Array },
): Promise<AssetRef> {
  const { status, body } = await deps.stage(session.siteId, details.name, bytes)
  if (status !== 200)
    throw new HTTPException(status, { message: (body as { error: string }).error })
  const asset = body as AssetRef
  // A file the site has already comes back as it is.
  if (store.read().document.assets[asset.id]) return asset
  const operation = { type: 'asset.create', ...asset } as Operation
  for (const [key, value] of Object.entries(details))
    if (value !== undefined) Object.assign(operation, { [key]: value })
  const batch = { expectedRevision: store.revision, operations: [operation] }
  applied(deps, session, batch, await store.apply(batch))
  return store.read().document.assets[asset.id] as AssetRef
}

/** MCP Streamable HTTP at `/:id`, one transport and server per session, behind OAuth. */
export function mcpRoutes(deps: McpDeps): Hono {
  const app = new Hono()
  // Inline asset data is base64: 20 MB of bytes is about 27 MB of text.
  app.use(bodyLimit({ maxSize: 30 * 1024 * 1024 }))
  app.on(['GET', 'POST', 'DELETE'], '/:id', async (c) => {
    const siteId = c.req.param('id')
    const grant =
      (await deps.oauth.verify(c.req.header('authorization'), siteId)) ??
      (await deps.assertion?.(c.req.raw, siteId))
    if (!grant) {
      const metadata = `${deps.origin}/.well-known/oauth-protected-resource/mcp/${siteId}`
      c.header('WWW-Authenticate', `Bearer resource_metadata="${metadata}"`)
      return c.json({ error: 'Authentication required' }, 401)
    }
    // Parsed once here, so a tool call can be recorded; the transport takes it as parsedBody.
    const body: unknown =
      c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined
    // Loaded on the first request, so a runtime no AI app connects to never loads them.
    const [
      { createServer, InputError },
      { WebStandardStreamableHTTPServerTransport },
      { isInitializeRequest },
    ] = await Promise.all([
      import('@lacuno/mcp'),
      import('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'),
      import('@modelcontextprotocol/sdk/types.js'),
    ])
    const sessionId = c.req.header('mcp-session-id')
    let session = sessionId ? sessions.get(sessionId) : undefined
    if (sessionId && (session?.siteId !== siteId || session.connectionId !== grant.connectionId))
      return c.json({ error: 'Session not found' }, 404)
    if (!session && !isInitializeRequest(body))
      return c.json({ error: 'Initialize a session first' }, 400)
    // The site's one store, shared with the editor's requests, so the session sees their saves.
    const store = await deps.store(siteId)
    if (!session) {
      const { releases } = deps
      const created: Session = {
        siteId,
        connectionId: grant.connectionId,
        userId: grant.userId,
        user: grant.user,
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
        // The narrowest editor variant that is not narrower than the viewport, so the cache holds
        // only the widths deleting the asset removes.
        images: (asset, width) =>
          imageVariant(
            path.join(deps.dataDir, 'sites', siteId),
            asset,
            IMAGE_WIDTHS.find((w) => w >= width) ?? 1920,
          ).catch(() => undefined),
        onApply: (batch, result) => applied(deps, created, batch, result),
        importAsset: (asset) =>
          importFile(deps, created, created.store, asset).catch((error) => {
            throw error instanceof HTTPException ? new InputError(error.message) : error
          }),
        ...(deps.fetchUrl && { fetchUrl: deps.fetchUrl }),
        ...(deps.screenshot && { screenshot: deps.screenshot }),
        ...(deps.editor && {
          editorToken: {
            origin: deps.editor.origin,
            ...(deps.editor.connectorUrl ? { connectorUrl: deps.editor.connectorUrl } : {}),
            mint: () => deps.editor!.mint(grant, siteId),
          },
        }),
        uploadUrl: (details) => {
          const now = Date.now()
          for (const [token, upload] of uploads) if (upload.expires < now) uploads.delete(token)
          const token = randomBytes(32).toString('base64url')
          uploads.set(token, { session: created, details, expires: now + UPLOAD_MS })
          return {
            url: `${deps.origin}/mcp/${siteId}/upload/${token}`,
            expiresAt: new Date(now + UPLOAD_MS).toISOString(),
          }
        },
        ...(releases &&
          deps.canPublish(grant.userId) && {
            publish: async (name) => {
              const published = await publishTesting(releases, siteId, created.store.revision, name)
              deps.report?.(siteId, { user: created.userId, app: created.app, action: 'published' })
              return published
            },
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
  // An address from asset.upload takes one file, while the session that asked for it is open.
  app.put('/:id/upload/:token', async (c) => {
    const upload = uploads.get(c.req.param('token'))
    uploads.delete(c.req.param('token'))
    const session = upload?.session
    if (
      !upload ||
      !session ||
      upload.expires < Date.now() ||
      session.siteId !== c.req.param('id') ||
      !session.transport.sessionId ||
      sessions.get(session.transport.sessionId) !== session
    )
      return c.json(
        { error: 'This upload address is used or expired. Call asset.upload again.' },
        404,
      )
    deps.oauth.touch(session.connectionId)
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    const store = await deps.store(session.siteId)
    return c.json(await importFile(deps, session, store, { ...upload.details, bytes }), 201)
  })
  return app
}
