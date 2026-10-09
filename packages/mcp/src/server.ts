import { readFile, realpath } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { publicAssetPath } from '@lacuno/compiler'
import {
  type ApplyResult,
  applyPatches,
  type Batch,
  type DocumentStore,
  type Operation,
  referencesToAssets,
  referencesToCollections,
  referencesToEntry,
  subtreeIds,
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
import { imageInfo, type ReadAsset, type Screenshot, type ScreenshotOptions } from './screenshot.js'
import { viewDomain } from './view-domain.js'

const PAGE_VIEW_URI = 'ui://lacuno/page-view'
/** The MCP Apps profile: a host that renders views shows the resource in an iframe. */
const PAGE_VIEW_MIME = 'text/html;profile=mcp-app'
let pageViewHtml: Promise<string> | undefined
/** The view's HTML, beside this module in source and in a bundle's output, read once. */
const pageView = () =>
  (pageViewHtml ??= readFile(new URL('./page-view.html', import.meta.url), 'utf8'))
/** Spike: the view that bootstraps the editor itself inside the host. */
const EDITOR_VIEW_URI = 'ui://lacuno/editor-view'
let editorViewHtml: Promise<string> | undefined
const editorView = () =>
  (editorViewHtml ??= readFile(new URL('./editor-view.html', import.meta.url), 'utf8'))
/** claude.ai's stable origin for a connector's views: the first 32 hex of its address's sha256. */

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
  /**
   * A raster image as a WebP about `width` wide, where the runtime keeps variants; a screenshot
   * then sends that instead of the original, a fraction of a photo's bytes.
   */
  images?: (asset: AssetRef, width: number) => Promise<Buffer | undefined>
  /** Takes `page.screenshot`'s images; without it the tool is not offered. */
  screenshot?: Screenshot
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
  /**
   * Spike: offers editor.session, a short-lived bearer the embedded editor calls `origin` with,
   * and editor.open with the view that bootstraps the editor there. `connectorUrl` names the
   * view's origin at claude.ai.
   */
  editorToken?: {
    origin: string
    connectorUrl?: string
    mint: () => { token: string; site: string; expiresAt: string }
    /** What the grant's user last reported selecting in the embedded editor, for editor.selection. */
    selection: () => { page: string; node?: string | undefined; at: number } | undefined
  }
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

/**
 * Models fill optional fields they do not need with '' or null; every tool reads those as not
 * given, so `page: ''` next to a component is no second target. The schemas they see stay as
 * written.
 */
/** What each tool may do, for the apps that call it: reads change nothing; adds create without destroying. */
const reads = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}
const adds = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}

function lenient(shape: z.ZodRawShape): z.ZodRawShape {
  return Object.fromEntries(
    Object.entries(shape).map(([key, field]) => [
      key,
      z.safeParse(field, undefined).success
        ? z.preprocess((value) => (value === '' || value === null ? undefined : value), field)
        : field,
    ]),
  )
}

export function createServer(store: DocumentStore, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'lacuno', version: '0.0.0' })
  const register = server.registerTool.bind(server)
  server.registerTool = ((name, config, callback) =>
    register(
      name,
      config.inputSchema
        ? {
            ...config,
            inputSchema: lenient(config.inputSchema as z.ZodRawShape) as typeof config.inputSchema,
          }
        : config,
      callback,
    )) as typeof server.registerTool
  let buildQueue: Promise<unknown> = Promise.resolve()

  server.registerTool(
    'guide',
    {
      annotations: reads,
      description: `Documentation only, changes nothing: how the Lacuno document works and the catalog of the ${MCP_OPERATIONS.length} operations document.apply accepts, each with its fields. Groups: ${operationGroups().join(', ')}.`,
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      description:
        'The one tool that changes a site: applies a batch of operations from the catalog in guide to the site document, atomically, each validated against its own schema. Pass the revision you read; use dryRun to preview patches.',
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
        if (dryRun) return ok(result)
        options.onApply?.(batch, result)
        // The patches repeat everything the batch created, several times the batch's own size.
        const { patches: _patches, ...applied } = result
        return ok(applied)
      } catch (e) {
        return fail(e)
      }
    },
  )

  server.registerTool(
    'document.diff',
    {
      annotations: reads,
      description:
        'Read-only: what a batch of operations would change (a dry run), or what changed since the lacuno.json at path against, inside the site folder. json: structured output.',
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
      annotations: { ...adds, openWorldHint: true },
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
        annotations: adds,
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
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: true,
        },
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
        annotations: { ...adds, idempotentHint: true },
        description:
          'Build the site folder to static output with the compiler. siteUrl is used only when the document has no site.url.',
        inputSchema: { siteUrl: z.url().optional() },
      },
      async ({ siteUrl }) => {
        const run = buildQueue.then(async () => {
          if (!options.siteDir) throw new InputError('this server has no site folder to build')
          // Loaded on first use: Astro is most of a server's start-up otherwise.
          const { build } = await import('@lacuno/compiler/build')
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
      annotations: reads,
      description:
        'Overview of the document: revision, site, pages, folders, classes, breakpoints, design tokens, components, collections, assets. No nodes, styles or entries. Each asset and collection lists `usedBy`, the places that reference it (empty when unused, so asset.delete can remove it).',
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
        collections,
        ...overview
      } = document
      const withUses = <T>(map: Record<string, T>, uses: Map<string, string[]>) =>
        Object.fromEntries(
          Object.entries(map).map(([id, item]) => [id, { ...item, usedBy: uses.get(id) ?? [] }]),
        )
      return ok({
        revision,
        ...overview,
        collections: withUses(collections, referencesToCollections(document)),
        assets: withUses(assets, referencesToAssets(document)),
      })
    },
  )

  server.registerTool(
    'page.outline',
    {
      annotations: reads,
      description:
        'Indented node tree of a page (by id or path, as page.preview takes it) or a component: id, tag, classes, text snippet. Classes are shown by id, usable with styles.get and style.set.',
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
          page !== undefined
            ? (d.pages[page] ?? Object.values(d.pages).find((p) => p.path === page))?.root
            : d.components[component as string]?.root
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
      annotations: reads,
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

  const { screenshot } = options
  if (screenshot) {
    /** Renders a route like the canvas does, feeding the screenshot the assets it references. */
    const capture = async (d: Document, html: string, shot: ScreenshotOptions) => {
      const { siteDir } = options
      const readAsset =
        options.assets ??
        (siteDir &&
          ((hash: string) => readFile(join(siteDir, 'assets', hash)).catch(() => undefined)))
      if (!readAsset) throw new InputError('this server has no site folder')
      return screenshot(
        html,
        async (path) => {
          const asset = Object.values(d.assets).find((a) => publicAssetPath(a) === path)
          if (!asset) return undefined
          const variant = await options.images?.(asset, shot.width)
          if (variant) return { mime: 'image/webp', body: variant }
          const body = await readAsset(asset.hash)
          return body && { mime: asset.mime, body }
        },
        shot,
      )
    }
    server.registerTool(
      'page.screenshot',
      {
        annotations: reads,
        description:
          'JPEG of a route in Chromium: the first screen (height, 800 by default) or the whole page with fullPage, cut at maxHeight (4000 by default); or a PNG of one element with node. A long full page reaches you shrunk until its text is unreadable, so check sections with node instead.',
        inputSchema: {
          page: z.string(),
          entry: z.string().optional(),
          width: z.number().int().positive().max(2560).optional(),
          height: z.number().int().positive().max(2560).optional(),
          fullPage: z.boolean().optional(),
          maxHeight: z.number().int().positive().max(16384).optional(),
          node: z.string().optional(),
        },
      },
      async ({ page, entry, width = 1280, height = 800, fullPage, maxHeight, node }) => {
        try {
          const d = store.read().document
          if (node !== undefined && !d.nodes[node]) throw new InputError(`unknown node ${node}`)
          const html = previewHtml(d, resolveRoute(d, page, entry), node !== undefined)
          const shot = await capture(d, html, {
            width,
            ...(fullPage ? { maxHeight } : { height }),
            node,
          })
          const image = Buffer.isBuffer(shot) ? shot : shot.image
          const { mime, ...size } = imageInfo(image)
          return {
            content: [
              { type: 'image', data: image.toString('base64'), mimeType: mime },
              { type: 'text', text: `${size.width}×${size.height}` },
            ],
          }
        } catch (e) {
          return fail(e)
        }
      },
    )

    server.registerTool(
      'page.view',
      {
        annotations: reads,
        description:
          "Shows the page to the person as a picture with its sections outlined, in apps that render views; they can point at a section and ask for a change. Use it when the person wants to see or point at a page. For your own checks use page.screenshot. The picture itself is page.screenshot's.",
        inputSchema: {
          page: z.string(),
          entry: z.string().optional(),
          width: z.number().int().positive().max(2560).optional(),
        },
        _meta: { ui: { resourceUri: PAGE_VIEW_URI } },
      },
      async ({ page, entry, width = 1280 }) => {
        try {
          const d = store.read().document
          const route = resolveRoute(d, page, entry)
          const shot = await capture(d, previewHtml(d, route, true), { width, boxes: true })
          if (Buffer.isBuffer(shot)) throw new Error('The screenshot came without boxes.')
          // The view outlines at most 400; the shallowest are the sections a person points at.
          const shallowest = new Set(
            [...shot.boxes].sort((a, b) => a.depth - b.depth).slice(0, 400),
          )
          const boxes = shot.boxes
            .filter((box) => shallowest.has(box))
            .map(({ id, ...box }) => ({ id, label: d.nodes[id]?.meta?.label ?? box.tag, ...box }))
          const { id, name, path } = route.page
          const { height } = imageInfo(shot.image)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  site: d.site.name,
                  page: { id, name, path },
                  width,
                  height,
                  boxes,
                }),
              },
            ],
          }
        } catch (e) {
          return fail(e)
        }
      },
    )
    server.registerResource(
      'page-view',
      PAGE_VIEW_URI,
      {
        description: 'The view page.view shows: the page with its sections outlined',
        mimeType: PAGE_VIEW_MIME,
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: PAGE_VIEW_MIME, text: await pageView() }],
      }),
    )
  }

  const { editorToken } = options
  if (editorToken) {
    server.registerTool(
      'editor.session',
      {
        annotations: adds,
        description:
          "A short-lived token for the Lacuno editor embedded in a view, with the runtime's origin. For the editor view only.",
      },
      async () => {
        try {
          return ok({ ...editorToken.mint(), origin: editorToken.origin })
        } catch (e) {
          return fail(e)
        }
      },
    )
    server.registerTool(
      'editor.open',
      {
        annotations: reads,
        description:
          'Opens the Lacuno editor on a page for the person, in apps that render views. page: id or path. The person can switch pages and select elements there; call editor.selection to know what they mean.',
        inputSchema: { page: z.string() },
        _meta: { ui: { resourceUri: EDITOR_VIEW_URI } },
      },
      async ({ page }) => {
        try {
          const d = store.read().document
          const { name, path } = resolveRoute(d, page).page
          return text(`Opened "${name}" (${path}) in the editor.`)
        } catch (e) {
          return fail(e)
        }
      },
    )
    // The host may not hand the model the editor's context, so the editor reports its selection
    // to the runtime and the model asks for it here.
    server.registerTool(
      'editor.selection',
      {
        annotations: reads,
        description:
          'What the person has selected in the Lacuno editor open in this chat: the page and the element. Call it before editing whenever they say this, here, the selected element or this page, and work on what it names.',
      },
      async () => {
        const selection = editorToken.selection()
        const d = store.read().document
        const page = selection && d.pages[selection.page]
        // A report older than an hour is from an editor long closed.
        if (!page || selection.at < Date.now() - 60 * 60_000)
          return text('The editor is not open in this chat, or nothing was selected yet.')
        const node = selection.node ? d.nodes[selection.node] : undefined
        const tag = node && ('tag' in node ? node.tag : node.type)
        return ok({
          page: { id: page.id, name: page.name, path: page.path },
          node: node ? { id: node.id, label: node.meta?.label ?? tag, tag } : null,
          at: new Date(selection.at).toISOString(),
        })
      },
    )
    const ui = {
      csp: { connectDomains: [editorToken.origin], resourceDomains: [editorToken.origin] },
      ...(editorToken.connectorUrl ? { domain: viewDomain(editorToken.connectorUrl) } : {}),
    }
    server.registerResource(
      'editor-view',
      EDITOR_VIEW_URI,
      {
        description: 'The view editor.open shows: the Lacuno editor',
        mimeType: PAGE_VIEW_MIME,
        _meta: { ui },
      },
      async (uri) => ({
        contents: [
          { uri: uri.href, mimeType: PAGE_VIEW_MIME, text: await editorView(), _meta: { ui } },
        ],
      }),
    )
  }

  server.registerTool(
    'node.get',
    {
      annotations: reads,
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
      annotations: reads,
      description:
        'Style declarations by class (tag rules under "<class> <tag>"), breakpoint and state, as class → breakpoint → state → property → value. Pass one or more classes, or a node for the classes of it and everything inside it, in one call. All when neither is given.',
      inputSchema: {
        class: z.union([z.string(), z.array(z.string())]).optional(),
        node: z.string().optional(),
      },
    },
    async ({ class: cls, node }) => {
      const d = store.read().document
      if (node !== undefined && !d.nodes[node]) return fail(new InputError(`unknown node ${node}`))
      const wanted =
        node !== undefined
          ? new Set(subtreeIds(d, node).flatMap((id) => d.nodes[id]?.classes ?? []))
          : cls !== undefined
            ? new Set([cls].flat())
            : undefined
      const unknown = [...(wanted ?? [])].find((id) => !d.classes[id])
      if (unknown) return fail(new InputError(`unknown class ${unknown}`))
      const out: Record<string, Record<string, Record<string, Record<string, unknown>>>> = {}
      for (const decl of Object.values(d.styles)) {
        if (wanted && !wanted.has(decl.class)) continue
        const group = decl.tag ? `${decl.class} ${decl.tag}` : decl.class
        const byClass = out[group] ?? {}
        const byBreakpoint = byClass[decl.breakpoint] ?? {}
        const byState = byBreakpoint[decl.state] ?? {}
        byState[decl.property] = decl.important
          ? { value: decl.value, important: true }
          : decl.value
        byBreakpoint[decl.state] = byState
        byClass[decl.breakpoint] = byBreakpoint
        out[group] = byClass
      }
      return ok(out)
    },
  )

  server.registerTool(
    'entries.list',
    {
      annotations: reads,
      description:
        'Entries of a collection in order. Each lists `usedBy`, the places that reference it (empty when unused, so entry.delete can remove it).',
      inputSchema: { collection: z.string(), limit: z.number().int().positive().optional() },
    },
    async ({ collection, limit }) => {
      const d = store.read().document
      if (!d.collections[collection])
        return fail(new InputError(`unknown collection ${collection}`))
      const entries = (d.entries[collection] ?? []).slice(0, limit)
      return ok(
        entries.map((entry) => ({
          ...entry,
          usedBy: referencesToEntry(d, collection, entry.id),
        })),
      )
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
