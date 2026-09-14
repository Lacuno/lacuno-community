# Roadmap

Phases, not dates. Each phase has an exit condition we can demonstrate.

## Phase 0. Foundation

Goal: the document, the compiler and an agent can produce a real site before there is an editor.

- `packages/schema`: document schema, validation, migrations, fixtures.
- `packages/css`: deterministic CSS generator with snapshot tests.
- `packages/compiler`: document to Astro project. `freeflow build` produces static output.
- `packages/mcp` and `freeflow mcp`: discovery, pages, nodes, classes, styles, tokens, components,
  dry run, version pinning, operating on a document in a local folder.
- Default template documents written by an agent through the MCP server.

**Exit:** Claude Code builds a three-page marketing site with a blog layout through MCP alone, and
`freeflow build` publishes it with a Lighthouse performance score of 100.

## Phase 1. Editor MVP

Goal: a designer can build and publish a site without touching the terminal.

- Server with auth, workspaces, sites, SQLite, Yjs sync, git commits.
- Editor: canvas iframe, layer tree, element palette, style panel, classes, breakpoints, states,
  tokens, pages, page settings and SEO, assets, fonts, undo and redo, version history.
- Components with props and slots.
- Publish to staging and production from the instance, build history, rollback.
- Docker image and `npx freeflow`.
- Preview, screenshot and diff tools in MCP.

**Exit:** a five-page site with components, tokens and dark mode, built in the editor, published on
a custom domain with TLS from a single container.

## Phase 2. Content and forms

Goal: the reasons people pay for Webflow.

- Native collections, fields, references, collection templates and lists.
- Content editor mode and roles.
- Forms with submissions, notifications, webhooks.
- Import from Webflow clipboard, Webstudio JSON, HTML plus CSS, Tailwind HTML, CSV.
- Export the Astro project to a git remote. Deploy hooks for external hosts.

**Exit:** a blog with fifty posts and a contact form, imported from a Webflow export, published
and receiving submissions.

## Phase 3. Agent on the canvas

Goal: the differentiator.

- Proposals as branches with preview builds and a rendered diff in the editor.
- In-app agent panel with selection context and slash commands.
- Skills in the repository, default skills, semantic annotations, design linter.
- Model providers with BYO keys and Ollama.

**Exit:** "build a pricing page using our brand skill" produces a proposal that respects tokens and
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
