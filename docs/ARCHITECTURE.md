# Architecture

## Overview

```
                    ┌──────────────────────────────────────────────┐
                    │                 Lacuno server               │
                    │  Hono + Node 22                               │
  Browser ─────────►│  ├─ /api        REST + tRPC-style typed API   │
  (editor SPA)      │  ├─ /ws         Yjs sync + presence           │
  Claude, ChatGPT ─►│  ├─ /mcp        MCP over streamable HTTP,     │
  Cursor, VS Code   │  │              OAuth per site, no model calls │
                    │  ├─ /build      build queue → Astro compiler   │
                    │  ├─ /forms      submissions endpoint for       │
  Published site ──►│  │              published sites                │
                    │  └─ /sites/*    serves published static output │
                    │                                               │
                    │  SQLite (Drizzle)   git repos    assets (fs/S3)│
                    └──────────────────────────────────────────────┘
                         Operator-managed proxy: TLS + host routing
```

The diagram includes planned services, not only implemented endpoints. The current Community
container exposes the editor/API on port 3000 and published static output on a separate listener
on port 3001. Builds run in child processes. Operators configure their own reverse proxy, DNS and
TLS; the application does not provision certificates or configure a proxy. Managed infrastructure
belongs to the planned Cloud service. See [self-hosting](SELF_HOSTING.md).

## Monorepo layout

```
lacuno/
  apps/
    server/        Hono app, wires everything below together, ships as the Docker image
    editor/        React SPA: canvas, panels, agent UI
    cli/           `lacuno` binary: local dev, MCP stdio bridge, export, import
  packages/
    schema/        Zod schema for the document. Types, validation, migrations. Zero deps beyond zod
    document/      Operations over the document: typed mutations compiled to patches, revision, dry run, persistence
    css/           The one CSS generator. Document → stylesheet. Used by renderer and compiler
    renderer/      Canvas HTML adapter over the compiler renderer, hosted in a React-managed iframe
    compiler/      Document + content → static site, using Astro as an internal engine
    cms/           Collection schema, storage, queries, export to content collections
    mcp/           MCP server: tool definitions over the document API
    agent/         Skills, semantic annotations, design linter
    importers/     Webflow clipboard, Webstudio JSON, HTML+CSS, Tailwind HTML, Markdown
    ui/            Shared editor UI kit (Radix-based)
  docs/
```

pnpm workspaces, Turborepo, TypeScript strict everywhere, Vitest, Playwright for the editor.

## The document

The document is the whole design of one site. It is normalized: flat maps keyed by id, with
references between them. Normalization makes patches small, CRDT-friendly and easy for agents to
target.

```ts
type Document = {
  version: number                       // schema version, migrations run on load
  site: SiteSettings                    // name, locales, head code, fonts, favicon
  pages: Map<PageId, Page>
  nodes: Map<NodeId, Node>              // the element tree, one map for all pages
  classes: Map<ClassId, Class>          // named style sources
  styles: Map<StyleKey, StyleDecl>      // (class, breakpoint, state, property) → value
  breakpoints: Map<BreakpointId, Breakpoint>
  designTokens: Map<DesignTokenId, DesignToken>  // per-mode values
  components: Map<ComponentId, Component>
  collections: Map<CollectionId, CollectionSchema>   // CMS schemas live in the document
  assets: Map<AssetId, AssetRef>        // metadata only, bytes live in storage
  redirects: Redirect[]
}

type Node = {
  id: NodeId
  type: 'element' | 'text' | 'component' | 'slot' | 'collection-list' | 'embed' | 'code-component'
  tag?: string                          // real HTML tag, always explicit for elements
  parent: NodeId | null
  children: NodeId[]
  classes: ClassId[]                    // ordered; later classes win, like combo classes
  localStyles?: StyleKey[]              // per-instance overrides, discouraged but allowed
  attrs: Record<string, AttrValue>      // static or bound to a CMS field or design token
  text?: RichText                       // for text nodes, Tiptap JSON
  rotatingWords?: { words: (string | { text; icon? })[]; icon?; interval?; transition?: 'slide' | 'fade' }  // text only
  component?: { ref: ComponentId; props: Record<string, PropValue>; overrides: NodeId[] }
  semantic?: { role?: string; archetype?: string; constraints?: Constraint[] }  // agent vocabulary
  meta: { label?: string; locked?: boolean; hidden?: boolean }
}

type StyleDecl = {
  class: ClassId
  breakpoint: BreakpointId              // 'base' is desktop-first
  state: State                          // 'none' | 'hover' | 'focus' | ... | '::before'
  property: string                      // real CSS property
  value: CssValue                       // typed: length, color, design token ref, keyword, gradient, raw
}
```

Design choices that matter:

- **Classes are the unit of style.** A node lists classes in order. Styles are keyed by class,
  breakpoint, state and property. This is the Webflow model and it compiles to real CSS.
- **Design tokens are values, not classes.** A design token is a named value with per-mode variants. It compiles
  to a custom property. Any style value can reference a design token.
- **Components are subtrees with a props schema.** An instance references a component and carries
  prop values plus explicit override nodes. Slots are nodes of type slot inside the component.
- **Collections are schema in the document, data in the database.** The design of a collection is
  part of the design. Entries are content and live in SQLite. On publish, entries are exported into
  the repository so the repository is a complete site.
- **Entries live in the document for now.** Until the server and its database exist, collection
  entries are a map in the document keyed by collection id. The content phase moves them out with a
  migration. Nothing else in the design depends on where they live.
- **Semantic annotations are optional and cheap.** Role and archetype like `hero`, `pricing`,
  `testimonial`, and constraints like `above-fold` give the agent and the linter a vocabulary
  above raw CSS without affecting output.
- **Every id is stable and opaque.** Agents and multiplayer both need this.

The schema package owns migrations. A document always loads; an old version is migrated in memory
and written back on the next commit.

## Live document and persistence

- In the editor, undo and redo replay a committed batch's patches inverted, so one drag is one
  undo step. Agent batches arrive over an event stream and are not the designer's undo steps.
- Yjs sync is deferred. When it lands, the document becomes a Yjs doc that panels subscribe to, and
  the server keeps it in memory per open site, syncs over WebSocket, and persists updates to SQLite
  as they arrive so a crash loses nothing.
- **Operations and revision.** Every change, from the editor or an agent, is a named operation
  (`node.create`, `style.set`, `designToken.setValue` and so on) with a Zod schema. Operations
  compile to five primitive patches (set, delete, insert, remove, move) that a plain-object
  applier runs, and whose inverses are what undo replays. A document store owns the revision
  counter: a batch names the revision it read, a stale batch is rejected, a dry run returns the
  patches without committing, and the whole result is validated before commit. Nothing outside
  the store's commit path can bump the revision.
- **Commits.** On publish or on explicit save, the document is serialized to
  JSON and committed to the site's git repository along with exported CMS entries and assets
  metadata. Git is the durable history; SQLite is the live buffer.
- Repository layout:

```
site/
  lacuno.json            the document, including collection entries for now
  assets/<hash>            asset bytes, addressed by content hash, no extension
  skills/*.md              agent skills for this site
  .lacuno/               build cache, ignored by git, owned by the build
  dist/                    static output, owned by the build
  node_modules/sharp       symlink the build creates so Astro's image step can load sharp
```

- The repository can be local to the instance or a remote the user controls. Push on commit is a
  setting.

## CSS generator

One package turns the document into a stylesheet. It is the only place CSS is produced.

- Design tokens become custom properties on `:root`, with mode variants on `[data-theme]` or a media
  query.
- Each class becomes one selector. Combo classes are emitted as compound selectors in node order,
  so `.button.primary` styles only apply where both are present, matching Webflow semantics.
- Breakpoints become media queries in cascade order. Base styles first, then narrower widths.
- States map to pseudo-classes and pseudo-elements. The canvas stylesheet, and only that one,
  also emits each state rule as `<selector>[data-lc-state~="<state>"]`, so the editor can force the
  picked state on the selected element.
- Output is deterministic: sorted keys, stable formatting, so diffs are readable and snapshot tests
  are stable.
- The same function runs in the canvas iframe and in the compiler. Parity tests render fixture
  documents both ways and compare computed styles per node.

## Canvas renderer

- The canvas is an iframe. Inside it, the renderer package renders the document to DOM with React,
  keyed by node id, and injects the generated stylesheet.
- The editor talks to the iframe over postMessage: selection, hover, drag targets, bounding boxes,
  text editing focus. No editor CSS or scripts run in the iframe except the thin instrumentation
  layer.
- Text editing is Tiptap mounted into the text node in place.
- Collection lists render sample entries from the CMS so the design shows real content.
- Breakpoint switching resizes the iframe; container queries and media queries then behave exactly
  as they will in production.

## Compiler

Document plus content in, static site out. Astro is the engine, not the product: nothing it
generates is meant to be read, edited or kept.

- A pure renderer turns a document and a page into head and body HTML. It resolves bindings,
  components, slots, collection lists and rich text, and never touches the filesystem, so it is
  tested with plain snapshots.
- The build writes a fixed scaffold into `.lacuno/astro`: one catch-all route, the generated
  stylesheet, the document as JSON, copied assets, and a `node_modules` directory holding
  symlinks to the installed Astro and compiler packages. The route enumerates every output path
  through `getStaticPaths`, calls the renderer, and wraps the result in real html, head and body
  tags so Astro can inline or link the stylesheet as it sees fit.
- Astro's programmatic build then produces `dist/`: compressed HTML, one minified stylesheet
  inlined when small, images optimized to AVIF and WebP with a width set, hashed asset names,
  redirects as meta-refresh pages, robots and a sitemap when the site URL is known.
- Every route is rendered once before Astro runs, so reference errors and warnings surface with
  node and page ids instead of being buried in bundler output.
- The build changes the process working directory for the duration of the Astro call, because
  Astro places its prerender bundle relative to the working directory. Builds must therefore run
  one at a time per process; the server's build queue runs them in a child process.
- Custom code enters through embeds today and code components later. Code components are inputs
  to the build, never files a developer edits in place.

The compiler has no knowledge of the server. The CLI exposes it as `lacuno build`.

## Server

- **Hono** on Node 22. Typed routes shared with the editor through a generated client.
- **Auth** with better-auth: email and password, magic link, then OIDC.
- **Storage** through Drizzle. SQLite by default with WAL. Postgres via config.
- **Tables** cover accounts, workspaces, sites, memberships, CMS entries, form submissions, builds,
  MCP connections, activity log, and the Yjs update buffer.
- **Build queue.** A small in-process queue runs each build in a child process, one at a time per
  site, because the build changes its working directory for Astro. Output goes to
  `builds/<site>/<build-id>/`. The first publishing milestone atomically updates a SQLite live-release
  pointer after a successful build; the separate static listener resolves that pointer per request.
  Immutable document snapshots and release states live in SQLite, builds run in child processes,
  and rollback switches the pointer without changing the draft. A testing pointer per site is served
  at `<site>-testing.<base>` and promoted to production without a rebuild; managed domain/TLS provisioning belongs to Cloud.
- **Serving.** Published output is served with immutable caching for hashed assets and short
  caching for HTML. An operator-managed reverse proxy terminates TLS and forwards published hosts
  to the isolated static listener, preserving the Host header.
- **Forms.** A published form posts to the instance, which validates, stores, notifies and
  optionally forwards to a webhook. Rate limiting and honeypot are built in.
- **Assets.** Content-addressed. Local disk by default, S3-compatible via config. Served through
  the instance or directly from the bucket.

## CLI

`lacuno` is a single binary with the same packages:

- `lacuno dev` runs the server locally against a folder.
- `lacuno build` produces the static output for a site folder.
- `lacuno mcp` runs the MCP server over stdio for local agents and proxies to a remote instance
  when configured.
- `lacuno export` and `lacuno import` move sites between instances and formats.
- `lacuno backup` and `lacuno restore` bundle the database, repositories and assets.

## Security posture

- Multi-tenant by workspace; every query is scoped.
- Custom code and embeds are user-trusted content and only render in the published site and the
  canvas iframe, never in editor chrome.
- Agent tool calls run under the permissions of the user who connected the app, scoped to one
  site by an OAuth token the user can revoke, and are recorded in the activity log.
- Form endpoints are rate limited per site and per IP.

## Performance targets

- Editor: selection and style edits reflect on canvas within one frame for documents of ten
  thousand nodes.
- Build: a fifty-page site with five hundred CMS entries builds in under thirty seconds on two
  cores.
- Published: Lighthouse performance of 100 on a default template with no user tuning.
