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
import { SqlitePersistence } from './persistence.js'

export type ServerOptions = {
  dataDir: string
  templateDir: string
  baseURL: string
  secret: string
  allowSignup?: boolean
  editorDir?: string
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
    const auth = betterAuth(authOptions)

    const app = new Hono<{ Variables: { userId: string; workspaceId: string } }>()
    app.use('/api/*', async (c, next) => {
      c.header('Cache-Control', 'no-store')
      await next()
    })
    app.use('/api/*', bodyLimit({ maxSize: 2 * 1024 * 1024 }))
    app.onError((error, c) => {
      if (error instanceof HTTPException) return error.getResponse()
      if (error instanceof StaleRevisionError)
        return c.json({ error: error.message, currentRevision: error.current }, 409)
      if (error instanceof OperationError || error instanceof DocumentError)
        return c.json({ error: error.message }, 400)
      console.error(error)
      return c.json({ error: 'Internal server error' }, 500)
    })
    app.get('/health', (c) => c.json({ status: 'ok' }))
    app.get('/api/config', (c) => c.json({ allowSignup: options.allowSignup ?? false }))
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
      const session = await auth.api.getSession({ headers: c.req.raw.headers })
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
      return c.json({ ...renderCanvas(document, page, entry, c.req.param('id')), revision })
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
      close: () => {
        sqlite.close()
      },
    }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
