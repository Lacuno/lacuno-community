# Roadmap

Phases, not dates. Each phase has an exit condition we can demonstrate.

## Community and Cloud

Community is the AGPL builder, compiler, export and self-hosted publishing workflow, including
release history and rollback. Docker packaging and [self-hosting documentation](SELF_HOSTING.md)
support operators who handle their own infrastructure, domains, HTTPS, backups and updates.
Community does not provide managed domain/TLS provisioning or a hosting-management interface.

Cloud is a planned paid managed service: hosting, guided domain connection, certificate lifecycle,
managed deployments, backups, monitoring and updates. It is not implemented and does not change
this repository's license. See decision D014 for the product boundary and
[Cloud integration](CLOUD.md) for the separate repository's initial scope and remaining runtime work.

## Phase 0. Foundation — complete

Goal: the document, the compiler and an agent can produce a real site before there is an editor.

- `packages/schema`: document schema, validation, migrations, fixtures.
- `packages/css`: deterministic CSS generator with snapshot tests.
- `packages/document`: named operations over the document, primitive patches, a store with a
  revision counter, dry runs and atomic persistence to a site folder.
- `packages/compiler` and `apps/cli`: document to static output through Astro as an internal
  engine. `freeflow build <dir>` builds a site folder; a Lighthouse script guards the score.
- `packages/mcp` and `freeflow mcp`: stdio server with `guide`, `document.read`, `page.outline`,
  `node.get`, `styles.get`, `entries.list`, atomic `document.apply` with dry run and version
  pinning, `asset.import`, `site.build`, and JSON Schema resources, operating on a site folder.
- Default template documents written through the provider-independent MCP stdio server.

**Exit demonstrated on 2026-09-17:** an SDK MCP client authored the native default document through
the real stdio server after the one required empty-document bootstrap. Version-pinned operations
created the design tokens, shared components, three static pages, collection template, three entries
and preview asset; no model-provider integration was required. The CLI then generated six static
routes with no warnings. Browser checks covered the routes at desktop, mobile and 320px widths,
including navigation, headings, keyboard focus, contrast and horizontal overflow. All six routes
scored 100 in Lighthouse's performance category. `freeflow build` writes portable files to `dist/`;
it does not publish them online.

## Phase 1. Editor MVP

Goal: a designer can build and publish a site without touching the terminal.

**First milestone implemented:** the [server foundation](../apps/server/README.md) provides
email/password sessions, a private default workspace per user, site creation from the default
template (including assets), and authenticated document reads and version-pinned operations.
SQLite persists documents, sessions and rate-limit counters. Tests cover a real server process
restart, ownership isolation, atomic invalid batches, dry runs and conflicting writes.
New Community instances have token-protected first-run owner setup with automatic registration
closure. Better Auth remains responsible for credentials and sessions; existing accounts are preserved.
The [first visual editor](../apps/editor/README.md) adds sign-in and site selection, a sandboxed canvas
using the compiler's renderer, page and collection-entry previews, a layer tree, viewport presets,
and plain-text/base-class-style edits with conflict protection. Session undo/redo now reverses saved
batches by replaying their patches inverted, including keyboard shortcuts and original typed values.
The element palette inserts headings, paragraphs, sections and containers; sibling-order controls
and structural undo/redo preserve IDs. Shared component and collection structure remains protected.
**Publishing milestone implemented:** immutable revision snapshots, durable build status and errors,
a separate static serving origin, a published URL, persistent release history, and confirmed rollback
without changing the editing draft. Failed builds preserve the live site. Source and bundled server
tests cover publishing and restarts; browser tests cover publishing, republishing and rollback.
Managed custom domains/TLS are Cloud work. Staging environments, Yjs sync, collaborative undo and git history
remain to be built; this does not yet satisfy the full Phase 1 exit condition.

- Server with auth, workspaces, sites, SQLite, Yjs sync, git commits.
- Editor: canvas iframe, layer tree, element palette, style panel, classes, breakpoints, states,
  design tokens, pages, page settings and SEO, assets, fonts, undo and redo, version history.
- Components with props and slots.
- Publish to staging and production from the instance, build history, rollback.
- Docker image and operator-written configuration via the self-hosting guide; `npx freeflow` remains planned.
- Preview, screenshot and diff tools in MCP.

**Community exit:** a five-page site with components, design tokens and dark mode, built in the editor,
published and rolled back from the container. An operator can deploy it with their own domain and
TLS using the self-hosting guide; automated domain/TLS management is not a Community exit requirement.

## Phase 2. Content and forms

Goal: the reasons people pay for Webflow.

- Native collections, fields, references, collection templates and lists.
- Content editor mode and roles.
- Forms with submissions, notifications, webhooks.
- Import from Webflow clipboard, Webstudio JSON, HTML plus CSS, Tailwind HTML, CSV.
- Export the static output to a git remote. Deploy hooks for external hosts.

**Exit:** a blog with fifty posts and a contact form, imported from a Webflow export, published
and receiving submissions.

## Phase 3. Agent on the canvas

Goal: the differentiator.

- Proposals as branches with preview builds and a rendered diff in the editor.
- In-app agent panel with selection context and slash commands.
- Skills in the repository, default skills, semantic annotations, design linter.
- Model providers with BYO keys and Ollama.

**Exit:** "build a pricing page using our brand skill" produces a proposal that respects design tokens and
components, passes the linter, and is accepted from the review UI with one section edited by hand.

## Phase 4. Collaboration and scale

- Realtime multiplayer with presence and element comments.
- Background jobs and schedules.
- Postgres and S3 backends. Incremental builds.
- Localization.
- Code components and the plugin API.
- Template marketplace.

## Not planned

- Interactions timeline engine. Native CSS animation support instead, revisited on demand.
- Web app features: authentication for visitors, per-user state, dashboards.
- Freeflow-operated inference. Bring your own provider.
