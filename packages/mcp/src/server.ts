import { readFile, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { build } from '@lacuno/compiler/build'
import {
  type ApplyResult,
  applyPatches,
  type Batch,
  type DocumentStore,
  type Operation,
  referencesToAsset,
} from '@lacuno/document'
import { type AssetRef, Document, type Node, parseDocument } from '@lacuno/schema'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { diffDocuments, formatDiff } from './diff.js'
import { fail, InputError } from './errors.js'
import {
  catalog,
  GUIDE_INTRO,
  index,
  MCP_OPERATIONS,
  operationGroups,
  WITHHELD_OPERATIONS,
} from './guide.js'
import { outlineLines } from './outline.js'
import { previewHtml, previewText, resolveRoute } from './preview.js'
import { ok, text } from './result.js'
import { pngSize, type ReadAsset, screenshot } from './screenshot.js'

/** What an imported file is called and described as. */
export type AssetDetails = {
  name: string
  alt?: string | undefined
  width?: number | undefined
  height?: number | undefined
}

export type ServerOptions = {
  siteDir?: string
  /** Reads an asset's bytes for screenshots when they are not in `siteDir`. */
  assets?: ReadAsset
  /** Called after each committed `document.apply` batch. */
  onApply?: (batch: Batch, result: ApplyResult) => void
  /** Publishes the draft to the testing target; replaces `site.build` with `site.publish`. */
  publish?: (name: string | undefined) => Promise<{ url: string }>
  /**
   * The connected endpoint's import, which checks a file like an editor upload. Without it,
   * asset.import stores the bytes as the declared `mime`, as a site folder's author means them.
   */
  importAsset?: (asset: AssetDetails & { bytes: Uint8Array }) => Promise<AssetRef>
  /** Downloads a public https address; asset.import then takes `url`. */
  fetchUrl?: (url: string) => Promise<Uint8Array>
  /** A single-use address the client can PUT one file to; offers asset.upload. */
  uploadUrl?: (asset: AssetDetails) => { url: string; expiresAt: string }
}

/**
 * The canonical path of `file` inside `siteDir`. Canonical paths see through a symlink pointing
 * out of the site folder, which a lexical comparison of the requested path would not.
 */
async function insideSite(siteDir: string | undefined, file: string): Promise<string> {
  if (!siteDir) throw new InputError('this server has no site folder')
  const root = await realpath(resolve(siteDir))
  let target: string
  try {
    target = await realpath(resolve(root, file))
  } catch {
    throw new InputError(`no file at ${file}`)
  }
  if (target !== root && !target.startsWith(root + sep))
    throw new InputError('path must be inside the site folder')
  return target
}

export function createServer(store: DocumentStore, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'lacuno', version: '0.0.0' })
  let buildQueue: Promise<unknown> = Promise.resolve()

  server.registerTool(
    'guide',
    {
      description: `How the Lacuno document works and the operation catalog. Groups: ${operationGroups().join(', ')}.`,
      inputSchema: { group: z.string().optional() },
    },
    async ({ group }) => {
      try {
        return text(group === undefined ? `${GUIDE_INTRO}\n${index()}` : catalog(group))
      } catch (e) {
        return fail(e)
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
        const withheld = operations.find((o) => o.type in WITHHELD_OPERATIONS)
        if (withheld)
          throw new InputError(
            `${withheld.type} is not available here: ${WITHHELD_OPERATIONS[withheld.type]}`,
          )
        // The engine parses each operation with its own schema and reports the failing index
        // and path, so there is nothing to gain from parsing the batch again here.
        const batch = {
          expectedRevision,
          operations: operations as Operation[],
          ...(dryRun ? { dryRun } : {}),
        }
        const result = await store.apply(batch)
        if (!dryRun) options.onApply?.(batch, result)
        return ok(result)
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'document.diff',
    {
      description:
        'Summary of what operations would change (dry run) or of what changed since the lacuno.json at path against, inside the site folder. json: structured output.',
      inputSchema: {
        operations: z.array(z.looseObject({ type: z.string() })).optional(),
        against: z.string().optional(),
        json: z.boolean().optional(),
      },
    },
    async ({ operations, against, json }) => {
      try {
        if ((operations === undefined) === (against === undefined))
          throw new InputError('pass exactly one of operations or against')
        const { document, revision } = store.read()
        let before = document
        let after = document
        if (operations) {
          const { patches } = await store.apply({
            expectedRevision: revision,
            operations: operations as Operation[],
            dryRun: true,
          })
          after = applyPatches(document, patches)
        } else {
          const file = await insideSite(options.siteDir, against as string)
          before = parseDocument(JSON.parse(await readFile(file, 'utf8')))
        }
        const diff = diffDocuments(before, after)
        return json ? ok(diff) : text(formatDiff(diff))
      } catch (e) {
        return fail(e)
      }
    },
  )

  const details = {
    name: z.string().min(1),
    alt: z.string().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }
  server.registerTool(
    'asset.import',
    {
      description:
        'Import a file and return the asset reference. Pass one of: url, a public https address the server downloads; path, relative to the site folder and inside it; data, base64 (small files only: every byte costs tokens). For a local file on a connected site, use asset.upload instead.',
      inputSchema: {
        ...details,
        mime: z.string().min(1).optional(),
        url: z.string().optional(),
        path: z.string().optional(),
        data: z.string().optional(),
      },
    },
    async ({ mime, url, path: file, data, ...asset }) => {
      try {
        if ([url, file, data].filter((source) => source !== undefined).length !== 1)
          throw new InputError('pass exactly one of url, path or data')
        let bytes: Uint8Array
        if (url !== undefined) {
          if (!options.fetchUrl) throw new InputError('this server does not download addresses')
          bytes = await options.fetchUrl(url)
        } else if (file !== undefined) {
          bytes = new Uint8Array(await readFile(await insideSite(options.siteDir, file)))
        } else {
          bytes = new Uint8Array(Buffer.from(data as string, 'base64'))
        }
        if (options.importAsset) return ok(await options.importAsset({ ...asset, bytes }))
        if (mime === undefined) throw new InputError("pass the file's mime type")
        if (bytes.byteLength > 20 * 1024 * 1024) throw new InputError('asset larger than 20 MB')
        return ok(await store.importAsset({ ...asset, mime, bytes }))
      } catch (e) {
        return fail(e)
      }
    },
  )

  const { uploadUrl } = options
  if (uploadUrl)
    server.registerTool(
      'asset.upload',
      {
        description:
          "For a file on your machine: returns a single-use https address, valid 10 minutes. PUT the file to it, for example `curl -sS -T photo.jpg '<url>'`; the answer is the asset reference.",
        inputSchema: details,
      },
      async (asset) => {
        try {
          return ok(uploadUrl(asset))
        } catch (e) {
          return fail(e)
        }
      },
    )

  const { publish } = options
  if (publish)
    server.registerTool(
      'site.publish',
      {
        description: 'Publish the saved document to the testing address; returns its URL.',
        inputSchema: { name: z.string().max(80).optional() },
      },
      async ({ name }) => {
        try {
          return ok(await publish(name))
        } catch (e) {
          return fail(e)
        }
      },
    )
  else
    server.registerTool(
      'site.build',
      {
        description:
          'Build the site folder to static output with the compiler. siteUrl is used only when the document has no site.url.',
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
        'Overview of the document: revision, site, pages, folders, classes, breakpoints, design tokens, components, collections, assets. No nodes, styles or entries. Each asset lists `usedBy`, the places that reference it (empty when unused, so asset.delete can remove it).',
    },
    async () => {
      const { document, revision } = store.read()
      const {
        version: _v,
        revision: _r,
        nodes: _n,
        styles: _s,
        entries: _e,
        assets,
        ...overview
      } = document
      const withUses = Object.fromEntries(
        Object.entries(assets).map(([id, asset]) => [
          id,
          { ...asset, usedBy: referencesToAsset(document, id) },
        ]),
      )
      return ok({ revision, ...overview, assets: withUses })
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
    'page.preview',
    {
      description:
        "A route's HTML as published, without a build. page: id or path; entry: id or slug on a collection page; text: one line per text node, `nodeId<TAB>text`.",
      inputSchema: {
        page: z.string(),
        entry: z.string().optional(),
        text: z.boolean().optional(),
      },
    },
    async ({ page, entry, text: asText }) => {
      try {
        const d = store.read().document
        const route = resolveRoute(d, page, entry)
        return text(asText ? previewText(d, route).join('\n') : previewHtml(d, route))
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'page.screenshot',
    {
      description:
        "PNG of a route through Playwright's Chromium. The full page unless height is set; node crops to one element.",
      inputSchema: {
        page: z.string(),
        entry: z.string().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        node: z.string().optional(),
      },
    },
    async ({ page, entry, width = 1280, height, node }) => {
      try {
        const { siteDir } = options
        const readAsset =
          options.assets ??
          (siteDir &&
            ((hash: string) => readFile(join(siteDir, 'assets', hash)).catch(() => undefined)))
        if (!readAsset) throw new InputError('this server has no site folder')
        const d = store.read().document
        if (node !== undefined && !d.nodes[node]) throw new InputError(`unknown node ${node}`)
        const html = previewHtml(d, resolveRoute(d, page, entry), node !== undefined)
        const png = await screenshot(d, readAsset, html, {
          width,
          ...(height !== undefined ? { height } : {}),
          ...(node !== undefined ? { node } : {}),
        })
        const size = pngSize(png)
        return {
          content: [
            { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
            { type: 'text', text: `${size.width}×${size.height}` },
          ],
        }
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
        const byClass = out[decl.class] ?? {}
        const byBreakpoint = byClass[decl.breakpoint] ?? {}
        const byState = byBreakpoint[decl.state] ?? {}
        byState[decl.property] = decl.important
          ? { value: decl.value, important: true }
          : { value: decl.value }
        byBreakpoint[decl.state] = byState
        byClass[decl.breakpoint] = byBreakpoint
        out[decl.class] = byClass
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
    'lacuno://schema/document',
    { description: 'JSON Schema of the site document', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(z.toJSONSchema(Document, { unrepresentable: 'any' }), null, 2),
        },
      ],
    }),
  )
  server.registerResource(
    'operations-schema',
    'lacuno://schema/operations',
    { description: 'JSON Schema of document.apply operations', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            z.toJSONSchema(
              z.discriminatedUnion(
                'type',
                MCP_OPERATIONS.map((o) => o.schema) as unknown as [z.ZodObject, ...z.ZodObject[]],
              ),
              { unrepresentable: 'any' },
            ),
            null,
            2,
          ),
        },
      ],
    }),
  )

  return server
}
