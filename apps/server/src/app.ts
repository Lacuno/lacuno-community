import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DocumentStore, Operation, OperationError, StaleRevisionError } from '@freeflow/document'
import { renderCanvas } from '@freeflow/renderer'
import { DocumentError, hashAsset, parseDocument } from '@freeflow/schema'
import { serveStatic } from '@hono/node-server/serve-static'
import { type BetterAuthOptions, betterAuth } from 'better-auth'
import { getMigrations } from 'better-auth/db/migration'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { migrateApplication, openDatabase, sites, workspaces } from './database.js'
import { GatewayAuth, type GatewayOptions } from './gateway-auth.js'
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
}

const SiteInput = z.strictObject({ name: z.string().trim().min(1).max(200) })
const BatchInput = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  operations: z.array(Operation).min(1).max(1000),
  dryRun: z.boolean().optional(),
})

export async function createServer(options: ServerOptions) {
  if (options.secret.length < 32) throw new Error('Auth secret must contain at least 32 characters')
  const origin = new URL(options.baseURL).origin
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
    // Only the token-protected setup endpoint can reach this registration-enabled handler.
    const setupAuth = betterAuth({
      ...authOptions,
      emailAndPassword: { enabled: true, disableSignUp: false },
    })
    releases = options.publishBaseURL
      ? new Releases(sqlite, options.dataDir, options.publishBaseURL)
      : undefined
    if (releases?.siteForHost(new URL(origin).hostname))
      throw new Error('The editor hostname cannot be inside the published site namespace')

    const app = new Hono<{
      Variables: {
        userId: string
        workspaceId: string
        gatewayUser: { id: string; name: string; email: string }
      }
    }>()
    app.use('/api/*', async (c, next) => {
      c.header('Cache-Control', 'no-store')
      await next()
    })
    app.use('/api/*', (c, next) =>
      bodyLimit({
        maxSize: c.req.path.endsWith('/assets/upload') ? 15 * 1024 * 1024 : 2 * 1024 * 1024,
      })(c, next),
    )
    app.onError((error, c) => {
      if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
      if (error instanceof StaleRevisionError)
        return c.json({ error: error.message, currentRevision: error.current }, 409)
      if (error instanceof OperationError || error instanceof DocumentError)
        return c.json({ error: error.message }, 400)
      console.error(error)
      return c.json({ error: 'Internal server error' }, 500)
    })
    app.get('/health', (c) => c.json({ status: 'ok' }))
    app.get('/api/config', (c) =>
      c.json({
        allowSignup: !gateway && !setup?.singleOwner && (options.allowSignup ?? false),
        setupRequired: setup?.required ?? false,
        ...(gateway ? { authentication: 'gateway', gatewayProtocol: 1 } : {}),
      }),
    )
    if (gateway) {
      app.use('*', async (c, next) => {
        try {
          c.set('gatewayUser', await gateway.authenticate(c.req.raw))
        } catch {
          return c.json({ error: 'Authenticated gateway required' }, 401)
        }
        await next()
      })
      app.get('/api/auth/get-session', (c) => c.json({ user: c.get('gatewayUser') }))
      app.on(['GET', 'POST'], '/api/auth/*', (c) =>
        c.json({ error: 'Authentication is managed by the gateway' }, 403),
      )
    }
    app.post('/api/setup', async (c) => {
      if (!setup) return c.json({ error: 'Owner setup is unavailable in gateway mode' }, 403)
      if (!setup.required)
        return c.json({ error: 'Owner setup is already complete or unavailable.' }, 409)
      if (c.req.header('origin') !== origin || c.req.header('sec-fetch-site') === 'cross-site')
        return c.json({ error: 'Untrusted origin' }, 403)
      if (c.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json')
        return c.json({ error: 'Expected application/json' }, 415)
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
      // Require same-origin JSON writes even for endpoints outside Better Auth's CSRF checks.
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
          })
          .from(sites)
          .where(eq(sites.workspaceId, c.get('workspaceId')))
          .all(),
      }),
    )
    app.post('/api/sites', async (c) => {
      const input = SiteInput.safeParse(await c.req.json().catch(() => null))
      if (!input.success) return c.json({ error: 'Invalid site name' }, 400)
      const template = parseDocument(
        JSON.parse(await readFile(path.join(options.templateDir, 'freeflow.json'), 'utf8')),
      )
      const document = parseDocument({
        ...template,
        revision: 0,
        site: { ...template.site, name: input.data.name },
      })
      const id = randomUUID()
      const dir = path.join(options.dataDir, 'sites', id)
      try {
        await mkdir(path.join(dir, 'assets'), { recursive: true })
        for (const asset of Object.values(document.assets)) {
          const bytes = await readFile(path.join(options.templateDir, 'assets', asset.hash))
          if ((await hashAsset(bytes)) !== asset.hash)
            throw new Error(`Template asset checksum mismatch: ${asset.id}`)
          await writeFile(path.join(dir, 'assets', asset.hash), bytes)
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
    const store = (id: string) =>
      DocumentStore.withPersistence(new SqlitePersistence(db, id, options.dataDir))
    app.get('/api/sites/:id/releases', (c) =>
      c.json(
        releases?.list(c.req.param('id')) ?? {
          enabled: false,
          publishedId: null,
          url: null,
          releases: [],
        },
      ),
    )
    app.post('/api/sites/:id/releases', async (c) => {
      if (!releases) return c.json({ error: 'Publishing is not configured on this server.' }, 503)
      const input = z
        .strictObject({
          expectedRevision: z.number().int().nonnegative(),
          publishedId: z.string().uuid().nullable(),
        })
        .safeParse(await c.req.json().catch(() => null))
      if (!input.success) return c.json({ error: 'Invalid publish request' }, 400)
      return c.json(
        releases.publish(c.req.param('id'), input.data.expectedRevision, input.data.publishedId),
        202,
      )
    })
    app.post('/api/sites/:id/releases/:releaseId/activate', async (c) => {
      if (!releases) return c.json({ error: 'Publishing is not configured on this server.' }, 503)
      const input = z
        .strictObject({ publishedId: z.string().uuid().nullable() })
        .safeParse(await c.req.json().catch(() => null))
      if (!input.success) return c.json({ error: 'Invalid rollback request' }, 400)
      releases.rollback(c.req.param('id'), c.req.param('releaseId'), input.data.publishedId)
      return c.json({ publishedId: c.req.param('releaseId') })
    })
    app.get('/api/sites/:id/document', async (c) => c.json((await store(c.req.param('id'))).read()))
    app.get('/api/sites/:id/preview', async (c) => {
      const { document, revision } = (await store(c.req.param('id'))).read()
      const page = document.pages[c.req.query('page') ?? '']
      if (!page) return c.json({ error: 'Page not found' }, 404)
      const entry = page.collection
        ? document.entries[page.collection]?.find((item) => item.id === c.req.query('entry'))
        : undefined
      if (page.collection && !entry)
        return c.json({ error: 'Choose a collection entry to preview' }, 400)
      const component = c.req.query('component')
      if (component && !document.components[component])
        return c.json({ error: 'Component not found' }, 404)
      return c.json({
        ...renderCanvas(document, page, entry, c.req.param('id'), component),
        revision,
      })
    })
    app.post('/api/sites/:id/assets/upload', async (c) => {
      const input = z
        .object({
          name: z.string().trim().min(1).max(255),
          data: z
            .string()
            .max(14 * 1024 * 1024)
            .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        })
        .safeParse(await c.req.json().catch(() => null))
      if (!input.success) return c.json({ error: 'Invalid image upload' }, 400)
      const bytes = Buffer.from(input.data.data, 'base64')
      if (!bytes.length || bytes.length > 10 * 1024 * 1024)
        return c.json({ error: 'Images must be 10 MB or smaller.' }, 413)
      const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? 'image/jpeg'
          : ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
            ? 'image/gif'
            : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
              ? 'image/webp'
              : ''
      if (!mime) return c.json({ error: 'Choose a PNG, JPEG, WebP, or GIF image.' }, 415)
      const hash = await hashAsset(bytes)
      const { document } = (await store(c.req.param('id'))).read()
      const existing = Object.values(document.assets).find((asset) => asset.hash === hash)
      if (existing) return c.json(existing)
      // Stage immutable bytes; registration goes through the editor's revision-checked undoable batch.
      await new SqlitePersistence(db, c.req.param('id'), options.dataDir).putAsset(bytes, hash)
      return c.json({
        id: `a-${randomUUID()}`,
        name: input.data.name,
        kind: 'image',
        hash,
        mime,
        size: bytes.length,
      })
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
    app.post('/api/sites/:id/document/apply', async (c) => {
      const input = BatchInput.safeParse(await c.req.json().catch(() => null))
      if (!input.success)
        return c.json({ error: 'Invalid operation batch', issues: input.error.issues }, 400)
      const batch = input.data
      return c.json(
        await (await store(c.req.param('id'))).apply({
          expectedRevision: batch.expectedRevision,
          operations: batch.operations as Operation[],
          ...(batch.dryRun === undefined ? {} : { dryRun: batch.dryRun }),
        }),
      )
    })
    if (options.editorDir) {
      app.get('/assets/*', serveStatic({ root: options.editorDir }))
      app.get('/', serveStatic({ path: path.join(options.editorDir, 'index.html') }))
    }
    return {
      app,
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
