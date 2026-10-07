# Architecture

## Overview

```
                    ┌──────────────────────────────────────────────┐
                    │                 Lacuno server               │
                    │  Hono + Node 22                               │
  Browser ─────────►│  ├─ /api        JSON API, server-sent events  │
  (editor SPA)      │  ├─ /ws         live collaboration (planned)  │
  Claude, ChatGPT ─►│  ├─ /mcp        MCP over streamable HTTP,     │
  Cursor, VS Code   │  │              OAuth per site, no model calls │
                    │  ├─ /build      build queue → Astro compiler   │
  Published site ──►│  ├─ /sites/*    serves published static output │
                    │  └─ /_lacuno/forms  form messages, by email    │
                    │                                               │
                    │  SQLite (Drizzle)        assets (filesystem)  │
                    └──────────────────────────────────────────────┘
                         Operator-managed proxy: TLS + host routing
```

The diagram includes planned services, not only implemented endpoints. The current Community
container exposes the editor/API on port 3000 and published static output on a separate listener
on port 3001. Builds run in child processes. Operators configure their own reverse proxy, DNS and
TLS; the application does not provision certificates or configure a proxy. Managed infrastructure
belongs to [Lacuno Cloud](CLOUD.md). See [self-hosting](SELF_HOSTING.md).

## Monorepo layout

```
lacuno/
  apps/
    server/        Hono app, wires everything below together, ships as the Docker image
    editor/        React SPA: canvas, panels, Connect your AI, the in-browser try build
    cli/           `lacuno build` and `lacuno mcp` over a site folder
  packages/
    schema/        Zod schema for the document. Types, validation, migrations. Zero deps beyond zod
    document/      Operations over the document: typed mutations compiled to patches, revision, dry run, persistence
    css/           The one CSS generator. Document → stylesheet. Used by renderer and compiler
    renderer/      Canvas HTML adapter over the compiler renderer, hosted in a React-managed iframe
    compiler/      Document + content → static site, using Astro as an internal engine
    mcp/           MCP server: tool definitions over the document API
  templates/
    lacuno/        The default site new sites start from
  docs/
```

Collections, fields and entries live in `schema` and `document`. Packages for skills and the design
linter, importers and a shared UI kit are planned, not present.

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
- **Per-element styles are a local class.** An element's own formatting goes into an unnamed
  local class of that element, so it compiles like any other class and sits last in its list.
- **Collections and their entries live in the document** (D019): entries are a map keyed by
  collection id, and operations check every value against its field type.
- **Semantic annotations are optional and cheap.** Role and archetype like `hero`, `pricing`,
  `testimonial`, and constraints like `above-fold` give the agent and the linter a vocabulary
  above raw CSS without affecting output.
- **Every id is stable and opaque.** Agents and multiplayer both need this.

The schema package owns migrations. A document always loads; an old version is migrated in memory
and written back on the next commit.

## Live document and persistence

- **Operations and revision** (D026). Every change, from the editor or an agent, is a named
  operation (`node.create`, `style.set`, `designToken.setValue` and so on) with a Zod schema.
  Operations compile to five primitive patches (set, delete, insert, remove, move) that a
  plain-object applier runs with structural sharing. A document store owns the revision counter:
  a batch names the revision it read, a stale batch is rejected, a dry run returns the patches
  without committing, and the whole result is validated before commit. Nothing outside the store's
  commit path can bump the revision.
- **Validation and errors.** Each operation checks its preconditions against the draft as it
  stands at that point in the batch, so a batch can refer to ids it created earlier. The full schema
  and reference check then runs on the result. Failures are `StaleRevisionError` (expected and
  current revision), `OperationError` (operation index, type, and the referencing paths when a
  delete is refused), `DocumentError` (the issue list) or `PatchError` (a planner bug).
- **Undo and redo.** In the editor, undo and redo replay a committed batch's patches inverted, so
  one drag is one undo step. Batches from AI apps arrive over a server-sent event stream, land on
  the canvas and join the open editor's history as one step each, so the designer can take back
  what their AI did; batches from another editor session do not.
- **Persistence** is an interface: SQLite on the server, a folder for the CLI, IndexedDB in the
  in-browser try build and memory in tests. The server stores each site's document and revision in
  one conditional statement, so two writers cannot commit on the same revision. The folder
  implementation writes `lacuno.json` to a temporary file and renames it over the old one,
  serializes deterministically (schema key order, sorted id maps, two-space indent) so a diff shows
  only the change.
- **Not built yet:** Yjs sync (D006) and git commits of the document (D005).

A site folder, as `lacuno build` and `lacuno mcp` use it:

```
site/
  lacuno.json              the document, including collection entries
  assets/<hash>            asset bytes, addressed by content hash, no extension
  .lacuno/                 build cache, owned by the build
  dist/                    static output, owned by the build
  node_modules/sharp       symlink the build creates so Astro's image step can load sharp
```

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

- The canvas is an iframe sandboxed with `allow-same-origin` only, plus a CSP that blocks
  scripts, forms, frames and external resources. Site scripts and embeds never run there.
- Its HTML comes from `@lacuno/renderer`: the compiler's renderer and the CSS generator, with node
  ids on elements and assets served from the site's authenticated URLs; an image whose size is
  known lists the server's resized variants in `srcset`, with `sizes="auto, 100vw"` so a browser
  loads the variant for the width the image renders at. The server renders it per revision, in
  the answer to the editor's own save and on request after a page switch or another actor's
  batch; the try build renders it in a service worker.
- The editor loads the first render once and morphs every later one into the live document in
  place (D028), so scroll, selection and open controls survive an edit.
- The selection overlay, spacing and size handles, the colour wheel and the state chip live in a
  shadow root inside the iframe, where site CSS cannot reach them. Drag previews write a draft
  rule into the canvas and commit once on release as one undo step.
- Text editing is Tiptap mounted into the text node in place.
- Collection lists and collection pages render real entries from the document.
- Breakpoint switching resizes the iframe, so media queries behave exactly as they will in
  production.

## Compiler

Document plus content in, static site out. Astro is the engine, not the product: nothing it
generates is meant to be read, edited or kept.

- A pure renderer turns a document and a page into head and body HTML. It resolves bindings,
  components, slots, collection lists and rich text, and never touches the filesystem, so it is
  tested with plain snapshots.
- The build writes a fixed scaffold into `.lacuno/astro`: one catch-all route, a module that
  optimizes every image once per build, the generated stylesheet, the document as JSON, the assets
  hard-linked in, and a `node_modules` directory holding symlinks to the installed Astro and
  compiler packages. The route enumerates every output path through `getStaticPaths`, calls the
  renderer, and wraps the result in real html, head and body tags so Astro can inline or link the
  stylesheet as it sees fit.
- Astro's programmatic build then produces `dist/`: compressed HTML, one minified stylesheet
  inlined when small, images optimized to WebP with a width set, hashed asset names,
  redirects as meta-refresh pages, robots and a sitemap when the site URL is known.
- Every route is rendered once before Astro runs, so reference errors and warnings surface with
  node and page ids instead of being buried in bundler output. Warnings never fail a build; a
  missing reference always does. Errors are reported as `document` (invalid file), `render` (with
  node and page) or `engine` (Astro or sharp).
- Images bound to an asset become an `<img>` with a WebP `srcset` at widths from 320 to 1920 up
  to the original's or the build's `maxImageWidth` (Cloud's plans cap it; a publish learns it with
  its build slot), carrying the `width` and `height` of its largest variant, `loading="lazy"` and
  `decoding="async"` unless the node sets its own, and `sizes` defaulting to `100vw`. Alt text comes
  from the node, then the asset, then an empty string. Images used in CSS `url()` values are copied
  unoptimized.
- A component instance's children are its slot content; a child names its slot with a static
  `slot` attribute, which is not emitted, and falls into `default` otherwise. An embed publishes
  its HTML verbatim, inside a `div` only when the embed has classes or attributes.
- The build changes the process working directory for the duration of the Astro call, because
  Astro places its prerender bundle relative to the working directory. Builds must therefore run
  one at a time per process; the server's build queue runs them in a child process.
- Custom code enters through embeds and head or body code today, and code components later. Code
  components are inputs to the build, never files a developer edits in place.

The compiler has no knowledge of the server. The CLI exposes it as `lacuno build`.

## Server

- **Hono** on Node 22, serving the editor, its JSON API and the MCP endpoint on one origin.
- **Auth** with Better Auth: email and password, a one-time owner setup (D015), and an OAuth
  authorization server for AI apps (D016). Behind a trusted gateway, signed per-request assertions
  replace local sign-in ([gateway mode](GATEWAY_AUTH.md)). Magic links and OIDC are planned.
- **Storage** in SQLite (better-sqlite3, WAL) with Drizzle. Postgres is planned (D008).
- **Tables** cover accounts and sessions, OAuth clients, consents and tokens, workspaces, sites
  (document and revision), releases, publication pointers, site thumbnails and gateway state.
- **Live edits.** Every committed batch goes out on a per-site server-sent event stream with its
  revision, patches, actor and a one-line summary; an editor that missed revisions reads the
  document again.
- **Build queue.** A small in-process queue runs each build in a child process, one at a time,
  because the build changes its working directory for Astro. Output goes to
  `builds/<site>/<release>/`. A successful build atomically updates the SQLite publication pointer
  for its target (production or testing, D027); the separate static listener resolves that pointer
  per request. Rollback switches the pointer without changing the draft. Managed domain and TLS
  provisioning belongs to Cloud.
- **Serving.** Published output is served on its own listener and origin, with immutable caching
  for hashed assets and short caching for HTML. An operator-managed reverse proxy terminates TLS and
  forwards published hosts to that listener, preserving the Host header.
- **Assets.** Content-addressed on local disk, typed by their first bytes on upload, images
  measured with sharp so an image asset carries its width and height. The editor's canvas and
  thumbnails ask the asset route for a width (`?w=`, 320 to 1920); the server resizes raster images
  to WebP with sharp on first demand, one at a time, never above the original, and keeps the
  result in `sites/<id>/cache/images/` until the asset is deleted. Uploads and imports record an
  image's size from its bytes and start its 320 and 960 variants in the background, and a start
  measures images registered without one, so every raster image lists its variants. Published sites get Astro's
  WebP variants instead. S3-compatible storage is planned.
- **Screenshots.** `page.screenshot` renders the page's preview HTML in headless Chromium, through
  a separate screenshot service (`screenshot-main`, its own image, a fixed number of slots over one
  browser) when `LACUNO_SCREENSHOT_URL` is set, otherwise through Playwright where it is installed;
  without either the tool is not offered. The runtime sends the HTML and only the assets it
  references; the browser serves those from memory and aborts every other request.
- **Forms** are plain `form` elements. One without its own `action` publishes posting to
  `/_lacuno/forms` on the site's host, with a honeypot and a small script that sends it in the
  background and shows the result. The publishing listener validates the message, rate-limits it
  per visitor in memory and mails it to the workspace owner over SMTP (Nodemailer); nothing is
  stored yet (D029). Behind a gateway, the gateway answers form posts instead.

## CLI

`lacuno` works on a site folder with the same packages:

- `lacuno build [dir]` produces the static output. `--out`, `--site-url` (used only when the
  document has no `site.url`) and `--json` are its options.
- `lacuno mcp [dir]` serves the MCP tools over stdio for local agents.
- Planned: `lacuno dev`, `export` and `import`. Server backups use the operator tool described in
  the [server README](../apps/server/README.md).

## Security posture

- Multi-tenant by workspace; every query is scoped.
- Custom code and embeds are user-trusted content and only render in the published site and the
  canvas iframe, never in editor chrome.
- Agent tool calls run under the permissions of the user who connected the app, scoped to one
  site by an OAuth token the user can revoke, and each batch appears in the editor's History with
  the app's name.
- Published sites are served on a separate origin from the editor, so their scripts never share
  its cookies.

## Performance targets

- Editor: selection and style edits reflect on canvas within one frame for documents of ten
  thousand nodes.
- Build: a fifty-page site with five hundred CMS entries builds in under thirty seconds on two
  cores.
- Published: Lighthouse performance of 100 on a default template with no user tuning.
