import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { build } from '@freeflow/compiler/build'
import type { DocumentStore } from '@freeflow/document'
import { Operation } from '@freeflow/document'
import type { Node } from '@freeflow/schema'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { fail, InputError } from './errors.js'
import { catalog, GUIDE_INTRO, index, operationGroups } from './guide.js'
import { outlineLines } from './outline.js'
import { ok, text } from './result.js'
import { documentJsonSchema, operationsJsonSchema } from './schemas.js'

export type ServerOptions = { siteDir?: string }

function ensure<V>(map: Record<string, V>, key: string, make: () => V): V {
  if (!(key in map)) map[key] = make()
  return map[key] as V
}

export function createServer(store: DocumentStore, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'freeflow', version: '0.0.0' })
  let buildQueue: Promise<unknown> = Promise.resolve()

  server.registerTool(
    'guide',
    {
      description: `How the Freeflow document works and the operation catalog. Groups: ${operationGroups().join(', ')}.`,
      inputSchema: { group: z.string().optional() },
    },
    async ({ group }) => {
      try {
        return text(group === undefined ? `${GUIDE_INTRO}\n${index()}` : catalog(group))
      } catch (e) {
        return fail(e instanceof RangeError ? new InputError(e.message) : e)
      }
    },
  )

  server.registerTool(
    'document.apply',
    {
      description:
        'Apply a batch of operations atomically. Pass the revision you read; use dryRun to preview patches.',
      inputSchema: {
        expectedRevision: z.number().int().nonnegative(),
        operations: z.array(z.looseObject({ type: z.string() })),
        dryRun: z.boolean().optional(),
      },
    },
    async ({ expectedRevision, operations, dryRun }) => {
      try {
        const parsed = z.array(Operation).safeParse(operations)
        if (!parsed.success) {
          const issues = parsed.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          }))
          return fail(new InputError('invalid operations', issues))
        }
        return ok(
          await store.apply({
            expectedRevision,
            operations: parsed.data as Operation[],
            ...(dryRun ? { dryRun } : {}),
          }),
        )
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'asset.import',
    {
      description:
        'Import an asset from a file path or base64 bytes; returns the asset reference. path is relative to the site folder and must stay inside it.',
      inputSchema: {
        name: z.string().min(1),
        mime: z.string().min(1),
        path: z.string().optional(),
        base64: z.string().optional(),
        alt: z.string().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
      },
    },
    async ({ name, mime, path: file, base64, alt, width, height }) => {
      try {
        if ((file === undefined) === (base64 === undefined))
          throw new InputError('pass exactly one of path or base64')
        let bytes: Uint8Array
        if (file !== undefined) {
          if (!options.siteDir) throw new InputError('this server has no site folder')
          const root = resolve(options.siteDir)
          const resolved = resolve(root, file)
          if (resolved !== root && !resolved.startsWith(root + sep))
            throw new InputError('path must be inside the site folder')
          bytes = new Uint8Array(await readFile(resolved))
        } else {
          bytes = new Uint8Array(Buffer.from(base64 as string, 'base64'))
        }
        const maxBytes = 20 * 1024 * 1024
        if (bytes.byteLength > maxBytes) throw new InputError('asset larger than 20 MB')
        return ok(
          await store.importAsset({
            name,
            mime,
            bytes,
            ...(alt !== undefined ? { alt } : {}),
            ...(width !== undefined ? { width } : {}),
            ...(height !== undefined ? { height } : {}),
          }),
        )
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'site.build',
    {
      description: 'Build the site folder to static output with the compiler.',
      inputSchema: { siteUrl: z.url().optional() },
    },
    async ({ siteUrl }) => {
      const run = buildQueue.then(async () => {
        if (!options.siteDir) throw new InputError('this server has no site folder to build')
        return build(options.siteDir, {
          quiet: true,
          ...(siteUrl !== undefined ? { siteUrl } : {}),
        })
      })
      buildQueue = run.catch(() => undefined)
      try {
        const r = await run
        return ok({ pages: r.pages, warnings: r.warnings, outDir: r.outDir })
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'document.read',
    {
      description:
        'Overview of the document: revision, site, pages, folders, classes, breakpoints, design tokens, components, collections, assets. No nodes, styles or entries.',
    },
    async () => {
      const { document: d, revision } = store.read()
      return ok({
        revision,
        site: d.site,
        pages: d.pages,
        folders: d.folders,
        classes: d.classes,
        breakpoints: d.breakpoints,
        designTokens: d.designTokens,
        components: d.components,
        collections: d.collections,
        assets: d.assets,
        redirects: d.redirects,
      })
    },
  )

  server.registerTool(
    'page.outline',
    {
      description:
        'Indented node tree of a page or a component: id, tag, classes, text snippet. Classes are shown by id, usable with styles.get and style.set.',
      inputSchema: {
        page: z.string().optional(),
        component: z.string().optional(),
        depth: z.number().int().nonnegative().optional(),
      },
    },
    async ({ page, component, depth }) => {
      try {
        const d = store.read().document
        if ((page === undefined) === (component === undefined))
          throw new InputError('pass exactly one of page or component')
        const root =
          page !== undefined ? d.pages[page]?.root : d.components[component as string]?.root
        if (!root)
          throw new InputError(
            `unknown ${page !== undefined ? 'page' : 'component'} ${page ?? component}`,
          )
        return text(outlineLines(d, root, depth).join('\n'))
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'node.get',
    {
      description: 'One node and its subtree as a nested tree.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const d = store.read().document
      if (!d.nodes[id]) return fail(new InputError(`unknown node ${id}`))
      const tree = (nid: string): unknown => {
        const n = d.nodes[nid] as Node
        return { ...n, children: n.children.map(tree) }
      }
      return ok(tree(id))
    },
  )

  server.registerTool(
    'styles.get',
    {
      description:
        'Style declarations grouped by class, breakpoint and state. All classes when class is omitted.',
      inputSchema: { class: z.string().optional() },
    },
    async ({ class: cls }) => {
      const d = store.read().document
      if (cls !== undefined && !d.classes[cls]) return fail(new InputError(`unknown class ${cls}`))
      const out: Record<string, Record<string, Record<string, Record<string, unknown>>>> = {}
      for (const decl of Object.values(d.styles)) {
        if (cls !== undefined && decl.class !== cls) continue
        const value = decl.important
          ? { value: decl.value, important: true }
          : { value: decl.value }
        const byClass = ensure<Record<string, Record<string, Record<string, unknown>>>>(
          out,
          decl.class,
          () => ({}),
        )
        const byBreakpoint = ensure<Record<string, Record<string, unknown>>>(
          byClass,
          decl.breakpoint,
          () => ({}),
        )
        const byState = ensure<Record<string, unknown>>(byBreakpoint, decl.state, () => ({}))
        byState[decl.property] = value
      }
      return ok(out)
    },
  )

  server.registerTool(
    'entries.list',
    {
      description: 'Entries of a collection in order.',
      inputSchema: { collection: z.string(), limit: z.number().int().positive().optional() },
    },
    async ({ collection, limit }) => {
      const d = store.read().document
      if (!d.collections[collection])
        return fail(new InputError(`unknown collection ${collection}`))
      const entries = d.entries[collection] ?? []
      return ok(limit === undefined ? entries : entries.slice(0, limit))
    },
  )

  server.registerResource(
    'document-schema',
    'freeflow://schema/document',
    { description: 'JSON Schema of the site document', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(documentJsonSchema(), null, 2),
        },
      ],
    }),
  )
  server.registerResource(
    'operations-schema',
    'freeflow://schema/operations',
    { description: 'JSON Schema of document.apply operations', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(operationsJsonSchema(), null, 2),
        },
      ],
    }),
  )

  return server
}
