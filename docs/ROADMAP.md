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
The element palette inserts headings, paragraphs, images, sections, containers, links and buttons;
sibling-order controls and structural undo/redo preserve IDs. Shared component and collection
structure remains protected.
**Publishing milestone implemented:** immutable revision snapshots, durable build status and errors,
a separate static serving origin, a published URL, persistent release history, and confirmed rollback
without changing the editing draft. Failed builds preserve the live site. Source and bundled server
tests cover publishing and restarts; browser tests cover publishing, republishing and rollback.
Releases can be named when publishing and renamed later; the panel shows the live and newest
release and folds older ones into a closed "Earlier releases" section.
**Element states implemented:** a picker beside the breakpoint label edits hover, focus,
focus-visible, active, visited, first-child, last-child, odd and even; the canvas forces the picked
state on the selected element; published CSS carries the real pseudo-class rules. The Motion tab's
hover shortcut is gone, and documents that used it are rewritten when they are read.
**Links and buttons implemented:** the palette's Actions group inserts a link or a button, Wrap
selection offers Link, and an `a` element's destination is editable in the inspector through the
same page-or-URL popover the text toolbar uses. A destination can be a page reference, which the
compiler resolves to the page's path, so a link follows a page through a path change.
**Palette completed:** the palette also inserts a span, a list (a `ul` of three items that the
inspector switches to numbered), a self-hosted video and an HTML embed. Uploads accept MP4 and WebM
next to images; the video inspector chooses a clip from the library and toggles controls, autoplay,
loop and muted. Embeds publish verbatim; the canvas shows a labelled placeholder where their
scripts and iframes would run. Form controls follow with the forms work in Phase 4.
**Design tokens implemented:** the ribbon's Design tokens dialog manages colour, spacing, size,
typography, radius and shadow tokens, named by group (`space.card`, `font.body`). Every matching
style field has a token button that binds it to a token, shows the bound token's name and can
detach it to a plain value. The canvas spacing and size handles snap to a token within 4px and
commit the reference; Ctrl or Cmd turns snapping off
([spec](superpowers/specs/2026-09-22-design-tokens-design.md)).
**Pages and SEO implemented:** **Site settings** in the Pages panel set the site name, public URL,
language, favicon, site-wide head and body code, and redirects. Page settings add a canonical URL,
hide from search engines, a social image and page code. A page at `/404` is the not-found page,
built to `404.html` and left out of the sitemap with hidden pages; the head gains `og:locale` and
`twitter:card` ([spec](superpowers/specs/2026-09-22-pages-and-seo-design.md)). Folders, page
templates, generated social images and a 500 page remain.
**Fonts implemented:** Site settings has a Fonts section: upload a WOFF2, WOFF, TTF or OTF file,
confirm the family, weight and style prefilled from its file name, or add a system font; each
family has a fallback. Both font fields list the site's families before three built-in stacks.
The published site self-hosts every face with a font-face rule and preloads each family's regular
face; nothing is requested from a third party (D013)
([spec](superpowers/specs/2026-09-22-fonts-design.md)).
**Style source implemented:** every style field in the panel and the text toolbar names where its
value comes from under the input: Local (with the wider breakpoint or base state it was set at), the
shared class or preset, the token it resolves through, the ancestor it inherits from, or Default
([spec](superpowers/specs/2026-09-23-style-source-design.md)). Clicking a line that names a class,
preset, token or ancestor goes there, and the Layout ribbon fits a 1500px window
([spec](superpowers/specs/2026-09-23-phase1-closers-design.md)).
**MCP preview, screenshot and diff implemented:** `page.preview` returns a route's published HTML
without a build, or its text one line per node id; `page.screenshot` returns a PNG of a route or one
node through Playwright's Chromium, an optional dependency; `document.diff` summarises a dry-run
batch or the changes since another `freeflow.json`
([spec](superpowers/specs/2026-09-23-mcp-preview-tools.md)).
**Testing implemented:** **Publish vN to testing** builds the draft for
`<site-id>-testing.<publishing base>`, which sends `X-Robots-Tag: noindex, nofollow`. The panel
shows Live and Testing badges; **Promote vN to production** makes the testing build live without a
rebuild, **Send vN to testing** points testing at any successful release and **Restore vN** stays
the production rollback. The cloud runtime's `--list` still reports production only
([spec](superpowers/specs/2026-09-23-testing-publish-design.md)).
Managed custom domains/TLS are Cloud work. Yjs sync, realtime collaboration
and git history remain to be built; this does not yet satisfy the full Phase 1 exit condition.
The planned direction for editing on the canvas itself, an action bar under the selection with
direct-manipulation controls, is written up in
[the canvas action bar direction](superpowers/specs/2026-09-21-canvas-action-bar-direction.md). Size handles on the
selection's right edge, bottom edge and corner set width and height in px by drag, previewing live
and committing once as one undo step; Shift on the corner keeps the aspect ratio
([spec](superpowers/specs/2026-09-22-size-handles-design.md)). The padding and margin handles are a
mode switched on by the selection's **Spacing** chip, which also draws the padding and margin areas
with their px values; focusing a sidebar spacing input or holding Alt over the element shows those
areas without the chip ([spec](superpowers/specs/2026-09-22-spacing-mode-design.md)).

- Server with auth, workspaces, sites, SQLite, git commits. Yjs sync deferred; undo ships as
  inverse patches.
- Editor: canvas iframe, layer tree, element palette, style panel, classes, breakpoints,
  states (implemented: hover, focus, focus-visible, active, visited, first, last, odd, even),
  design tokens, pages, page settings and SEO, assets, fonts, undo and redo (all implemented).
- Components with props (implemented). Slots and visible instance overrides move to the content
  phase, where they are built together with the CMS (decided 2026-09-23).
- Publish to testing and production from the instance, build history, rollback (implemented).
- Docker image and operator-written configuration via the self-hosting guide; `npx freeflow` remains planned.
- Preview, screenshot and diff tools in MCP (implemented).
- Clicking a style field's source line to jump to the class, token or ancestor it names, and the
  Layout ribbon fitting a 1500px window (implemented). That closes Phase 1.

**Deferred out of Phase 1 (2026-09-23):** version history with restore, fluid typography and spacing
with `clamp` scales, and restyling the default template to reference its own tokens. They are kept
under Future ideas below.

**Community exit:** a five-page site with components, design tokens and dark mode, built in the editor,
published and rolled back from the container. An operator can deploy it with their own domain and
TLS using the self-hosting guide; automated domain/TLS management is not a Community exit requirement.

## Phase 2. Connect your AI

Goal: the differentiator. A designer connects the AI app they already pay for to a site in one
click, and watches it work on the canvas. Freeflow never calls a model and never holds an API key;
the user's own subscription does the thinking, Freeflow gives it hands
([spec](superpowers/specs/2026-09-23-connect-your-ai-design.md)).

- A remote MCP endpoint per site on the Community server, exposing the existing tools over
  Streamable HTTP with OAuth. The same server that runs the editor is the MCP server.
- A prominent **Connect your AI** button in the editor: one card per app (Claude Code, Claude
  Desktop, claude.ai, ChatGPT, Cursor, VS Code), each with the best registration that app offers:
  an install link, a one-line command or a URL to paste, plus the OAuth consent screen. Localhost
  works for the desktop and CLI apps; the cloud-hosted apps need a public address.
- The editor shows which app is connected and when it last acted, and lets you disconnect it.
- Live view: the agent's batches stream into the open editor and land on the canvas without a
  reload, touched elements flash, and an activity list names each batch. The designer's own
  pending edits are never overwritten.
- Uploads through MCP (inline file data instead of a server path) and publish to testing from MCP,
  so an agent can show its result on the testing origin.

**Exit:** from a fresh site, click Connect your AI, pick Claude, approve once, and ask it for a
pricing page in the site's tokens and components. The page appears in the editor while Claude
builds it, the connection badge shows Claude working, and one section is then edited by hand and
published.

## Phase 3. Agent on the canvas

Goal: the agent works with the designer's context, not beside it.

- Selection context through MCP: the agent can read what is selected, which page and breakpoint
  are open, and act on "this element".
- Skills in the repository and default skills (brand, layout, copy) that connected apps pick up.
- Semantic annotations and a design linter the agent can run before it hands over.

**Exit:** with a section selected, "make this match the hero" produces an edit that respects the
tokens and passes the linter, seen live on the canvas.

## Phase 4. Content and forms

Goal: the reasons people pay for Webflow. Deferred behind the AI work on 2026-09-23: an agent
already writes content through the document, so native content editing can wait.

- Native collections, fields, references, collection templates and lists.
- Components with slots and visible instance overrides in the layer tree, built with the
  collections work so page templates and layouts share one model.
- Content editor mode and roles.
- Forms with submissions, notifications, webhooks.
- Import from Webflow clipboard, Webstudio JSON, HTML plus CSS, Tailwind HTML, CSV.
- Export the static output to a git remote. Deploy hooks for external hosts.

**Exit:** a blog with fifty posts and a contact form, imported from a Webflow export, published
and receiving submissions.

## Phase 5. Collaboration and scale

- Realtime multiplayer with presence and element comments.
- Background jobs and schedules.
- Postgres and S3 backends. Incremental builds.
- Localization.
- Code components and the plugin API.
- Template marketplace.

## Future ideas

Not scheduled; recorded so they are not lost.

- Version history and restore: browsable draft snapshots distinct from releases, restorable
  without a publish.
- Fluid typography and spacing: a design token that is a scale (`clamp` between two sizes) rather
  than one value.
- Default template bound to its own tokens, so a new site shows tokens working from the first edit.
- Testing protection: a password or a private link for the testing origin.

## Not planned

- Interactions timeline engine. Native CSS animation support instead, revisited on demand.
- Web app features: authentication for visitors, per-user state, dashboards.
- Model calls of any kind: no Freeflow-operated inference, no bring-your-own key, no provider
  settings. The user's own AI app connects through MCP.
- Proposals as branches with a rendered diff; the live canvas is the review.
