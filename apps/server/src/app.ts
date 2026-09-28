import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import {
  DocumentStore,
  documentErrorResponse,
  type Operation,
  Patch,
  stageUpload,
  UploadInput,
} from '@lacuno/document'
import { renderPreview } from '@lacuno/renderer'
import { AssetHash, hashAsset, parseDocument } from '@lacuno/schema'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { and, eq, sql } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { migrateApplication, openDatabase, sites, workspaces } from './database.js'
import { type SiteEvent, siteEvents, summarize } from './events.js'
import { exportActivity, exportAsset, exportThumbnail } from './export.js'
import { fetchFile } from './fetch-file.js'
import { GatewayAuth, type GatewayOptions, refusal } from './gateway-auth.js'
import { activeConnections, closeSessions, closeUserSessions, mcpRoutes } from './mcp.js'
import { createOAuth, gatewayUser, type OAuth, oauthPlugins, relayFetch } from './oauth.js'
import { OwnerSetup } from './owner-setup.js'
import { SqlitePersistence } from './persistence.js'
import { publishedApp } from './published.js'
import { Releases } from './releases.js'

export type ServerOptions = {
  dataDir: string
  templateDir: string
  baseURL: string
  secret: string
  allowSignup?: boolean
  editorDir?: string
  publishBaseURL?: string
  gateway?: GatewayOptions
  /** Cloud's Client ID Metadata Document relay, for a gateway runtime without internet access. */
  cimdRelay?: string
  /** Cloud's export sink, which receives every published release. Needs `gateway`. */
  export?: string
  /** Test-only: replaces the OAuth grants so tests can call the MCP endpoint with a fixed token. */
  oauth?: OAuth
}

/** A new site from the template, or from a document with its asset bytes as base64 by hash. */
const SiteInput = z
  .strictObject({
    name: z.string().trim().min(1).max(200),
    document: z.unknown().optional(),
    assets: z.record(AssetHash, z.base64()).optional(),
  })
  .refine((input) => (input.document === undefined) === (input.assets === undefined))
/** An empty release name clears it. */
const ReleaseName = z
  .string()
  .trim()
  .max(80)
  .transform((name) => name || null)
/** The pointer the caller saw for the target. */
const Pointer = {
  expectedId: z.string().uuid().nullable(),
  target: z.enum(['production', 'testing']).default('production'),
}
const BatchInput = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  /** Shape only; the store's engine validates each operation and names the one that failed. */
  operations: z
    .array(z.looseObject({ type: z.string() }))
    .min(1)
    .max(1000)
    .optional(),
  /** The patches of an earlier commit, replayed to undo or redo it. */
  patches: z.array(Patch).min(1).max(5000).optional(),
  dryRun: z.boolean().optional(),
})
/** A thumbnail's type from its first bytes: WebP, or JPEG where the browser encodes no WebP. */
function thumbnailType(image: Buffer) {
  if (image.toString('latin1', 0, 4) === 'RIFF' && image.toString('latin1', 8, 12) === 'WEBP')
    return 'image/webp'
  if (image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) return 'image/jpeg'
}
/** Routes a gateway forwards without a user, since each authenticates itself. */
const anonymous = (method: string, path: string) =>
  (method === 'GET' && path.startsWith('/.well-known/')) ||
  (method === 'POST' && /^\/api\/auth\/oauth2\/(register|token|revoke)$/.test(path)) ||
  (['GET', 'POST', 'DELETE'].includes(method) && /^\/mcp\/[^/]+$/.test(path)) ||
  (method === 'PUT' && /^\/mcp\/[^/]+\/upload\/[^/]+$/.test(path))

export async function createServer(options: ServerOptions) {
  if (options.secret.length < 32) throw new Error('Auth secret must contain at least 32 characters')
  if (options.export && !options.gateway) throw new Error('Export requires the gateway settings')
  const origin = new URL(options.baseURL).origin
  const exportOptions =
    options.export && options.gateway
      ? { url: options.export, secret: options.gateway.secret, issuer: origin }
      : undefined
  const { db, sqlite } = openDatabase(options.dataDir)
  let releases: Releases | undefined
  try {
    const authOptions = {
      database: sqlite,
      baseURL: origin,
      secret: options.secret,
      trustedOrigins: [origin],
      emailAndPassword: { enabled: true, disableSignUp: !options.allowSignup },
      rateLimit: { enabled: true, storage: 'database' },
      // Behind a gateway every request comes from the gateway; it names the client.
      ...(options.gateway
        ? { advanced: { ipAddress: { ipAddressHeaders: ['x-lacuno-client-ip'] } } }
        : {}),
      plugins: oauthPlugins({ origin, gateway: options.gateway, cimdRelay: options.cimdRelay }),
    } satisfies BetterAuthOptions
    const migrations = await getMigrations(authOptions)
    await migrations.runMigrations()
    migrateApplication(sqlite)
    if (!options.gateway && sqlite.prepare('SELECT id FROM gateway_mode WHERE id=1').get())
      throw new Error('Gateway configuration is required for this managed instance')
    const gateway = options.gateway ? new GatewayAuth(sqlite, options.gateway, origin) : undefined
    const setup = gateway ? undefined : new OwnerSetup(sqlite, options.allowSignup ?? false)
    if (gateway || setup?.singleOwner) authOptions.emailAndPassword.disableSignUp = true
    const auth = betterAuth(authOptions)
    const provider = createOAuth(auth, sqlite, origin, { gateway: !!gateway })
    // Tests may swap the verifier; the discovery routes stay the provider's.
    const oauth: OAuth = options.oauth ?? provider
    // Only the token-protected setup endpoint can reach this registration-enabled handler.
    const setupAuth = betterAuth({
      ...authOptions,
      emailAndPassword: { enabled: true, disableSignUp: false },
    })
    releases = options.publishBaseURL
      ? new Releases(sqlite, options.dataDir, options.publishBaseURL, exportOptions)
      : undefined
    if (releases?.siteForHost(new URL(origin).hostname))
      throw new Error('The editor hostname cannot be inside the published site namespace')

    const app = new Hono<{
      Variables: {
        userId: string
        workspaceId: string
        gatewayUser: Awaited<ReturnType<GatewayAuth['authenticate']>>
      }
    }>()
    app.use('/api/*', async (c, next) => {
      c.header('Cache-Control', 'no-store')
      await next()
    })
    app.use('/api/*', (c, next) =>
      bodyLimit({
        maxSize:
          c.req.path === '/api/sites'
            ? 90 * 1024 * 1024
            : c.req.path.endsWith('/assets/upload')
              ? 15 * 1024 * 1024
              : 2 * 1024 * 1024,
      })(c, next),
    )
    app.onError((error, c) => {
      if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
      const failure = documentErrorResponse(error)
      if (failure) return c.json(failure.body, failure.status)
      console.error(error)
      return c.json({ error: 'Internal server error' }, 500)
    })
    // Busy while work no request shows waits here: a build, or a publication or asset list for
    // Cloud's export sink. Cloud does not stop an idle runtime that is busy.
    const busy = sqlite.prepare(
      `SELECT EXISTS(SELECT 1 FROM releases WHERE status IN ('queued','building'))${
        exportOptions
          ? ' OR EXISTS(SELECT 1 FROM export_pointer) OR EXISTS(SELECT 1 FROM export_assets)'
          : ''
      } AS busy`,
    )
    app.get('/health', (c) =>
      c.json({ status: 'ok', busy: !!(busy.get() as { busy: number }).busy }),
    )
    app.route('/.well-known', provider.routes)
    app.get('/api/config', (c) =>
      c.json({
        allowSignup: !gateway && !setup?.singleOwner && (options.allowSignup ?? false),
        setupRequired: setup?.required ?? false,
        origin,
        local: ['localhost', '127.0.0.1'].includes(new URL(origin).hostname),
        ...(gateway ? { authentication: 'gateway', gatewayProtocol: 1 } : {}),
      }),
    )
    // Require same-origin JSON writes even for endpoints outside Better Auth's CSRF checks.
    const sameOriginJson: MiddlewareHandler = async (c, next) => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
        const requestOrigin = c.req.header('origin')
        if (
          (requestOrigin && requestOrigin !== origin) ||
          c.req.header('sec-fetch-site') === 'cross-site'
        )
          return c.json({ error: 'Untrusted origin' }, 403)
        if (c.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json')
          return c.json({ error: 'Expected application/json' }, 415)
      }
      await next()
    }
    if (gateway) {
      app.use('*', async (c, next) => {
        if (anonymous(c.req.method, c.req.path)) return next()
        const user = await gateway.authenticate(c.req.raw).catch(() => undefined)
        // Cloud's own assertions are good for revoking access and nothing else.
        if (!user || (user.system && c.req.path !== '/api/gateway/revoke-user'))
          return c.json({ error: 'Authenticated gateway required' }, 401)
        const refused = refusal(user.role, c.req.method, c.req.path)
        if (refused) return c.json({ error: refused }, 403)
        c.set('gatewayUser', user)
        await next()
      })
      app.get('/api/auth/get-session', (c) => c.json({ user: c.get('gatewayUser') }))
      // The consent flow, as the gateway's user.
      app.on(
        ['GET', 'POST'],
        '/api/auth/oauth2/:endpoint{authorize|public-client|consent}',
        sameOriginJson,
        (c) => gatewayUser.run(c.get('gatewayUser'), () => auth.handler(c.req.raw)),
      )
      app.post('/api/gateway/revoke-user', async (c) => {
        if (!c.get('gatewayUser').system)
          return c.json({ error: 'Only the gateway itself can revoke access' }, 403)
        const input = z
          .strictObject({ userId: z.string().min(1).max(200) })
          .safeParse(await c.req.json().catch(() => null))
        if (!input.success) return c.json({ error: 'Invalid user' }, 400)
        const { userId } = input.data
        gateway.forget(userId)
        return c.json({
          ...(await provider.revokeUser(userId)),
          sessions: await closeUserSessions(userId),
        })
      })
    }
    // OAuth clients post forms from other apps; these endpoints authenticate the client instead.
    app.post(
      `/api/auth/oauth2/:endpoint{token|register|revoke${gateway ? '' : '|introspect'}}`,
      (c) => auth.handler(c.req.raw),
    )
    if (gateway)
      app.on(['GET', 'POST'], '/api/auth/*', (c) =>
        c.json({ error: 'Authentication is managed by the gateway' }, 403),
      )
    app.use('/api/*', sameOriginJson)
    app.post('/api/setup', async (c) => {
      if (!setup) return c.json({ error: 'Owner setup is unavailable in gateway mode' }, 403)
      if (!setup.required)
        return c.json({ error: 'Owner setup is already complete or unavailable.' }, 409)
      const input = z
        .strictObject({
          name: z.string().trim().min(1).max(200),
          email: z.email(),
          password: z.string().min(8).max(128),
          token: z.string().max(128),
        })
        .safeParse(await c.req.json().catch(() => null))
      if (!input.success)
        return c.json({ error: 'Enter your name, email, password and setup token.' }, 400)
      if (!setup.accepts(input.data.token)) return c.json({ error: 'Invalid setup token.' }, 403)
      const { token: _, ...account } = input.data
      const response = await setupAuth.handler(
        new Request(`${origin}/api/auth/sign-up/email`, {
          method: 'POST',
          headers: c.req.raw.headers,
          body: JSON.stringify(account),
        }),
      )
      if (response.ok) setup.complete()
      else if (!setup.required)
        return c.json(
          { error: 'Owner setup was completed in another session. Sign in instead.' },
          409,
        )
      else if (response.status === 422)
        return c.json({ error: 'The owner account could not be created. Please try again.' }, 503)
      return response
    })
    app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
    app.use('/api/*', async (c, next) => {
      const session = gateway
        ? { user: { id: gateway.ownerId } }
        : await auth.api.getSession({ headers: c.req.raw.headers })
      if (!session) return c.json({ error: 'Authentication required' }, 401)
      c.set('userId', session.user.id)
      db.insert(workspaces)
        .values({
          id: randomUUID(),
          ownerId: session.user.id,
          name: 'My workspace',
        })
        .onConflictDoNothing({ target: workspaces.ownerId })
        .run()
      const workspace = db
        .select()
        .from(workspaces)
        .where(eq(workspaces.ownerId, session.user.id))
        .get()!
      c.set('workspaceId', workspace.id)
      await next()
    })
    app.get('/api/workspaces', (c) =>
      c.json({
        workspaces: db
          .select()
          .from(workspaces)
          .where(eq(workspaces.ownerId, c.get('userId')))
          .all(),
      }),
    )
    app.get('/api/sites', (c) =>
      c.json({
        sites: db
          .select({
            id: sites.id,
            workspaceId: sites.workspaceId,
            name: sites.name,
            revision: sites.revision,
            // The revision the site's thumbnail shows, or null before an editor drew one.
            thumbnail: sql<
              number | null
            >`(SELECT revision FROM site_thumbnail WHERE site_id=${sites.id})`,
          })
          .from(sites)
          .where(eq(sites.workspaceId, c.get('workspaceId')))
          .all(),
      }),
    )
    app.post('/api/sites', async (c) => {
      const input = SiteInput.safeParse(await c.req.json().catch(() => null))
      if (!input.success) return c.json({ error: 'Invalid site' }, 400)
      const { name, document: imported, assets } = input.data
      const source = parseDocument(
        assets
          ? imported
          : JSON.parse(await readFile(path.join(options.templateDir, 'lacuno.json'), 'utf8')),
      )
      const document = parseDocument({
        ...source,
        revision: 0,
        site: { ...source.site, name },
      })
      const id = randomUUID()
      const dir = path.join(options.dataDir, 'sites', id)
      try {
        await mkdir(path.join(dir, 'assets'), { recursive: true })
        for (const asset of Object.values(document.assets)) {
          const bytes = assets
            ? Buffer.from(assets[asset.hash] ?? '', 'base64')
            : await readFile(path.join(options.templateDir, 'assets', asset.hash))
          if ((await hashAsset(bytes)) !== asset.hash)
            throw assets
              ? new HTTPException(400, {
                  message: `Asset ${asset.id} is missing or does not match its hash`,
                })
              : new Error(`Template asset checksum mismatch: ${asset.id}`)
          await writeFile(path.join(dir, 'assets', asset.hash), bytes)
          if (exportOptions) await exportAsset(exportOptions, id, asset.hash, bytes)
        }
        db.insert(sites)
          .values({
            id,
            workspaceId: c.get('workspaceId'),
            name: document.site.name,
            revision: 0,
            document: JSON.stringify(document),
          })
          .run()
      } catch (error) {
        await rm(dir, { recursive: true, force: true })
        throw error
      }
      return c.json(
        { id, workspaceId: c.get('workspaceId'), name: document.site.name, revision: 0 },
        201,
      )
    })
    app.use('/api/sites/:id/*', async (c, next) => {
      const site = db
        .select({ id: sites.id })
        .from(sites)
        .where(and(eq(sites.id, c.req.param('id')!), eq(sites.workspaceId, c.get('workspaceId'))))
        .get()
      if (!site) return c.json({ error: 'Site not found' }, 404)
      await next()
    })
    const persistence = (id: string) =>
      new SqlitePersistence(db, id, options.dataDir, exportOptions)
    const store = (id: string) => DocumentStore.withPersistence(persistence(id))
    const stage = async (id: string, name: string, bytes: Uint8Array) =>
      stageUpload((await store(id)).read().document, persistence(id), name, bytes)
    // A gateway runtime has no internet access: it downloads through Cloud's relay, or not at all.
    const { cimdRelay } = options
    const download = !options.gateway
      ? fetchFile
      : cimdRelay &&
        ((url: string) =>
          fetchFile(
            url,
            relayFetch(cimdRelay, options.gateway!.secret, origin, 'lacuno-file-relay'),
          ))
    app.route(
      '/mcp',
      mcpRoutes({
        store,
        dataDir: options.dataDir,
        oauth,
        events: siteEvents,
        releases,
        origin,
        // Behind a gateway, only the owner's AI apps publish.
        canPublish: (userId) => !gateway || gateway.role(userId) === 'owner',
        stage,
        fetchUrl: download || undefined,
        report:
          exportOptions && ((site, activity) => void exportActivity(exportOptions, site, activity)),
      }),
    )
    // Who is asking: behind a gateway its user, otherwise the owner.
    const caller = (c: { get: (key: 'gatewayUser' | 'userId') => unknown }) =>
      (c.get('gatewayUser') as { id: string; role: string } | undefined) ?? {
        id: c.get('userId') as string,
        role: 'owner',
      }
    app.get('/api/sites/:id/connections', (c) => {
      const active = activeConnections(c.req.param('id'))
      const { id } = caller(c)
      return c.json(
        oauth.connections(c.req.param('id')).map(({ clientId: _, userId, ...connection }) => ({
          ...connection,
          mine: userId === id,
          active: active.has(connection.id),
        })),
      )
    })
    // Everyone may disconnect the AI apps they connected; only the owner disconnects others'.
    app.delete('/api/sites/:id/connections/:cid', async (c) => {
      const connection = oauth
        .connections(c.req.param('id'))
        .find((item) => item.id === c.req.param('cid'))
      if (!connection) return c.json({ error: 'Connection not found' }, 404)
      const { id, role } = caller(c)
      if (role !== 'owner' && connection.userId !== id)
        return c.json(
          { error: 'Only the workspace owner can disconnect someone else’s AI app' },
          403,
        )
      await oauth.revoke(c.req.param('id'), connection)
      await closeSessions(c.req.param('id'), connection.id)
      return c.body(null, 204)
    })
    app.get('/api/sites/:id/releases', (c) =>
      c.json(releases?.list(c.req.param('id')) ?? { enabled: false, releases: [] }),
    )
    app.post('/api/sites/:id/releases/*', async (c, next) => {
      if (!releases) return c.json({ error: 'Publishing is not configured on this server.' }, 503)
      await next()
    })
    app.post('/api/sites/:id/releases', async (c) => {
      const input = z
        .strictObject({
          expectedRevision: z.number().int().nonnegative(),
          name: ReleaseName.optional(),
          ...Pointer,
        })
        .safeParse(await c.req.json().catch(() => null))
      if (!input.success) return c.json({ error: 'Invalid publish request' }, 400)
      const { expectedId, target, expectedRevision, name } = input.data
      const { id } = releases!.publish(
        c.req.param('id'),
        expectedRevision,
        expectedId,
        name ?? null,
        target,
      )
      return c.json({ id, target }, 202)
    })
    app.post('/api/sites/:id/releases/:releaseId/name', async (c) => {
      const input = z
        .strictObject({ name: ReleaseName })
        .safeParse(await c.req.json().catch(() => null))
      if (!input.success) return c.json({ error: 'Invalid release name' }, 400)
      releases!.rename(c.req.param('id'), c.req.param('releaseId'), input.data.name)
      return c.json({ name: input.data.name })
    })
    app.post('/api/sites/:id/releases/:releaseId/activate', async (c) => {
      const input = z.strictObject(Pointer).safeParse(await c.req.json().catch(() => null))
      if (!input.success) return c.json({ error: 'Invalid rollback request' }, 400)
      const { expectedId, target } = input.data
      const id = c.req.param('releaseId')
      releases!.rollback(c.req.param('id'), id, expectedId, target)
      return c.json({ id, target })
    })
    app.get('/api/sites/:id/document', async (c) => c.json((await store(c.req.param('id'))).read()))
    // Every committed batch as it lands, after replaying the kept ones the client has not seen.
    app.get('/api/sites/:id/events', (c) => {
      const id = c.req.param('id')
      const since = Number(c.req.header('Last-Event-ID') ?? c.req.query('since') ?? 0)
      const response = streamSSE(c, async (stream) => {
        // One write at a time, so the replay and live events arrive in revision order.
        let writes = Promise.resolve()
        const send = (event: SiteEvent) => {
          writes = writes.then(() =>
            stream.writeSSE({
              event: 'batch',
              id: String(event.revision),
              data: JSON.stringify(event),
            }),
          )
        }
        for (const event of siteEvents.recent(id)) if (event.revision > since) send(event)
        stream.onAbort(siteEvents.subscribe(id, send))
        while (!stream.aborted) {
          await stream.sleep(25_000)
          await stream.write(': heartbeat\n\n')
        }
      })
      response.headers.set('Cache-Control', 'no-store')
      return response
    })
    app.get('/api/sites/:id/preview', async (c) => {
      const { document } = (await store(c.req.param('id'))).read()
      const { status, body } = renderPreview(document, c.req.param('id'), c.req.query())
      return c.json(body, status)
    })
    app.post('/api/sites/:id/assets/upload', async (c) => {
      const input = UploadInput.safeParse(await c.req.json().catch(() => null))
      if (!input.success) return c.json({ error: 'Invalid upload' }, 400)
      const { status, body } = await stage(
        c.req.param('id'),
        input.data.name,
        Buffer.from(input.data.data, 'base64'),
      )
      return c.json(body, status)
    })
    app.get('/api/sites/:id/assets/:hash', async (c) => {
      const hash = c.req.param('hash')
      if (!/^[a-f0-9]{64}$/.test(hash)) return c.notFound()
      const { document } = (await store(c.req.param('id'))).read()
      const asset = Object.values(document.assets).find((item) => item.hash === hash)
      if (!asset) return c.notFound()
      try {
        const bytes = await readFile(
          path.join(options.dataDir, 'sites', c.req.param('id'), 'assets', hash),
        )
        return c.body(new Uint8Array(bytes), 200, {
          'Content-Type': asset.mime,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'",
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return c.notFound()
        throw error
      }
    })
    // The home page's first screen as an editor drew it (editor thumbnail.ts), newest revision kept.
    app.post('/api/sites/:id/thumbnail', async (c) => {
      const input = z
        .strictObject({
          revision: z.number().int().nonnegative(),
          image: z.base64(),
        })
        .safeParse(await c.req.json().catch(() => null))
      const image = input.success ? Buffer.from(input.data.image, 'base64') : undefined
      // Cloud's export sink takes up to 256 KB; a drawing is about 20 KB.
      if (!input.success || !image || image.length > 256 * 1024 || !thumbnailType(image))
        return c.json({ error: 'Invalid thumbnail' }, 400)
      const id = c.req.param('id')
      const kept = sqlite
        .prepare(
          'INSERT INTO site_thumbnail(site_id,revision,image) VALUES(?,?,?) ON CONFLICT(site_id) DO UPDATE SET revision=excluded.revision,image=excluded.image WHERE excluded.revision >= site_thumbnail.revision',
        )
        .run(id, input.data.revision, image).changes
      // Cloud shows it on the dashboard without waking this runtime.
      if (kept && exportOptions) await exportThumbnail(exportOptions, id, image)
      return c.body(null, 204)
    })
    app.get('/api/sites/:id/thumbnail', (c) => {
      const row = sqlite
        .prepare('SELECT image FROM site_thumbnail WHERE site_id=?')
        .get(c.req.param('id')) as { image: Buffer } | undefined
      if (!row) return c.notFound()
      // The site list asks for it by revision, so it never changes under the same address.
      return c.body(new Uint8Array(row.image), 200, {
        'Content-Type': thumbnailType(row.image)!,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      })
    })
    app.post('/api/sites/:id/document/apply', async (c) => {
      const input = BatchInput.safeParse(await c.req.json().catch(() => null))
      if (!input.success)
        return c.json({ error: 'Invalid operation batch', issues: input.error.issues }, 400)
      const batch = input.data
      const result = await (await store(c.req.param('id'))).apply(
        batch.patches
          ? { expectedRevision: batch.expectedRevision, patches: batch.patches as Patch[] }
          : {
              expectedRevision: batch.expectedRevision,
              operations: batch.operations as Operation[],
              ...(batch.dryRun === undefined ? {} : { dryRun: batch.dryRun }),
            },
      )
      if (!batch.dryRun)
        siteEvents.emit(c.req.param('id'), {
          revision: result.revision,
          patches: result.patches,
          actor: { kind: 'editor' },
          at: Date.now(),
          summary: summarize(batch.operations as Operation[] | undefined, result.patches),
        })
      return c.json(result)
    })
    if (options.editorDir) {
      app.get('/assets/*', serveStatic({ root: options.editorDir }))
      for (const route of ['/', '/consent'])
        app.get(route, serveStatic({ path: path.join(options.editorDir, 'index.html') }))
    }
    return {
      app,
      oauth,
      published: releases ? publishedApp(releases) : undefined,
      close: () => {
        releases?.close()
        sqlite.close()
      },
    }
  } catch (error) {
    releases?.close()
    sqlite.close()
    throw error
  }
}
