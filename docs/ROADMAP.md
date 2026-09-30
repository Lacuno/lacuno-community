# Roadmap

Phases, not dates. Each phase has an exit condition we can demonstrate.

## Community and Cloud

Community is the AGPL builder, compiler, export and self-hosted publishing workflow, including
release history and rollback. Docker packaging and [self-hosting documentation](SELF_HOSTING.md)
support operators who handle their own infrastructure, domains, HTTPS, backups and updates.
Community does not provide managed domain/TLS provisioning or a hosting-management interface.

Lacuno Cloud, at [lacuno.io](https://lacuno.io), is the hosted service built on Community: it runs
the editor and the published sites for you, so there is no server to operate. It lives in a
separate repository and does not change this repository's license. See decision D014 for the
product boundary and [Cloud integration](CLOUD.md) for how the two connect.

## Phase 0. Foundation — complete

Goal: the document, the compiler and an agent can produce a real site before there is an editor.

- `packages/schema`: document schema, validation, migrations, fixtures.
- `packages/css`: deterministic CSS generator with snapshot tests.
- `packages/document`: named operations over the document, primitive patches, a store with a
  revision counter, dry runs and atomic persistence to a site folder.
- `packages/compiler` and `apps/cli`: document to static output through Astro as an internal
  engine. `lacuno build <dir>` builds a site folder; a Lighthouse script guards the score.
- `packages/mcp` and `lacuno mcp`: stdio server with `guide`, `document.read`, `page.outline`,
  `node.get`, `styles.get`, `entries.list`, atomic `document.apply` with dry run and version
  pinning, `asset.import`, `site.build`, and JSON Schema resources, operating on a site folder.
- Default template documents written through the provider-independent MCP stdio server.

**Exit demonstrated on 2026-09-17:** an SDK MCP client authored the native default document through
the real stdio server after the one required empty-document bootstrap. Version-pinned operations
created the design tokens, shared components, three static pages, collection template, three entries
and preview asset; no model-provider integration was required. The CLI then generated six static
routes with no warnings. Browser checks covered the routes at desktop, mobile and 320px widths,
including navigation, headings, keyboard focus, contrast and horizontal overflow. All six routes
scored 100 in Lighthouse's performance category. `lacuno build` writes portable files to `dist/`;
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
commit the reference; Ctrl or Cmd turns snapping off.
**Pages and SEO implemented:** **Site settings** in the Pages panel set the site name, public URL,
language, favicon, site-wide head and body code, and redirects. Page settings add a canonical URL,
hide from search engines, a social image and page code. A page at `/404` is the not-found page,
built to `404.html` and left out of the sitemap with hidden pages; the head gains `og:locale` and
`twitter:card`. Folders, page
templates, generated social images and a 500 page remain.
**Fonts implemented:** Site settings has a Fonts section: upload a WOFF2, WOFF, TTF or OTF file,
confirm the family, weight and style prefilled from its file name, or add a system font; each
family has a fallback. Both font fields list the site's families before three built-in stacks.
The published site self-hosts every face with a font-face rule and preloads each family's regular
face; nothing is requested from a third party (D013).
**Style source removed (2026-09-24):** the line under each style field naming where its value
comes from, and its jump to that class, preset, token or ancestor, overloaded the ribbon and was
taken out. The Layout ribbon fits a 1500px window.
**Ribbon removed (2026-09-27):** formatting lives in the inspector's groups, which remember being
opened or closed; the canvas bar holds the widths, zoom and focus, and Design tokens moved to the
sidebar rail. The canvas keeps its place in every selection state.
**MCP preview, screenshot and diff implemented:** `page.preview` returns a route's published HTML
without a build, or its text one line per node id; `page.screenshot` returns a PNG of a route or one
node through Playwright's Chromium, an optional dependency; `document.diff` summarises a dry-run
batch or the changes since another `lacuno.json`.
**Testing implemented:** **Publish vN to testing** builds the draft for
`<site-id>-testing.<publishing base>`, which sends `X-Robots-Tag: noindex, nofollow`. The panel
shows Live and Testing badges; **Promote vN to production** makes the testing build live without a
rebuild, **Send vN to testing** points testing at any successful release and **Restore vN** stays
the production rollback. `published-main.js --list` still reports production only.
Managed custom domains/TLS are Cloud work. Yjs sync, realtime collaboration
and git history remain to be built; this does not yet satisfy the full Phase 1 exit condition.
Editing moves onto the canvas where it is spatial. Size handles on the
selection's right edge, bottom edge and corner set width and height in px by drag, previewing live
and committing once as one undo step; Shift on the corner keeps the aspect ratio. The padding and
margin handles move a side and its opposite together, or one side with Alt, and are a mode
switched on by the selection's **Spacing** chip, which also draws the padding and margin areas
with their px values; focusing a sidebar spacing input or holding Alt over the element shows those
areas without the chip.

- Server with auth, workspaces, sites and SQLite (implemented). Git commits and Yjs sync are not
  built; undo ships as inverse patches.
- Editor: canvas iframe, layer tree, element palette, style panel, classes, breakpoints,
  states (implemented: hover, focus, focus-visible, active, visited, first, last, odd, even),
  design tokens, pages, page settings and SEO, assets, fonts, undo and redo (all implemented).
- Components with props (implemented). Slots and visible instance overrides move to the content
  phase, where they are built together with the CMS (decided 2026-09-23).
- Publish to testing and production from the instance, build history, rollback (implemented).
- Docker image and operator-written configuration via the self-hosting guide; `npx lacuno` remains planned.
- Preview, screenshot and diff tools in MCP (implemented).
- The editor fitting a 1500px window (implemented). That closes Phase 1.

**Deferred out of Phase 1 (2026-09-23):** version history with restore, fluid typography and spacing
with `clamp` scales, and restyling the default template to reference its own tokens. They are kept
under Future ideas below.

**Community exit:** a five-page site with components, design tokens and dark mode, built in the editor,
published and rolled back from the container. An operator can deploy it with their own domain and
TLS using the self-hosting guide; automated domain/TLS management is not a Community exit requirement.

## Phase 2. Connect your AI

Goal: the differentiator. A designer connects the AI app they already pay for to a site in one
click, and watches it work on the canvas. Lacuno never calls a model and never holds an API key;
the user's own subscription does the thinking, Lacuno gives it hands.

**First milestone implemented (2026-09-24):** `/mcp/:id` serves the existing tools over Streamable
HTTP behind OAuth issued by the same server (consent page in the editor, dynamic registration and
Client ID Metadata Documents, one site per token); the header's **Connect your AI** panel has cards
for Claude Code, claude.ai, Claude Desktop, ChatGPT, Cursor, VS Code, Codex CLI and Gemini CLI with
the registration each app documents and a connections list with Disconnect, and the header's
History lists the latest edits by you and by each app;
committed batches stream to the open editor over server-sent events and land on the canvas live
with a flash, queued behind the designer's own save; uploads take inline data and `site.publish`
builds to testing. Since 2026-09-25 tokens hang off a per-user anchor session instead of the
approving browser session, so signing out no longer ends a connection, and gateway mode serves the
OAuth, metadata and MCP routes for Cloud ([gateway protocol](GATEWAY_AUTH.md)). Open:
custom-scheme redirect URIs are refused by the provider.

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

**CMS panel implemented (2026-09-28):** the rail's CMS panel lists the collections and opens the
CMS dialog: create, rename and delete collections, add, rename, relabel, reorder and delete fields
with their options and reference targets, pick the slug field, and find entries in a table that
sorts, searches and pages by fifty. The entry form has an input per field type: rich text in
Tiptap, an image or file chosen from the assets or uploaded in place, a date, a number, a switch,
a colour, an option, and reference pickers that search the target collection; a new entry's slug
follows its title and must be unique. Deleting what is used is refused with the places that use it;
deletes can be undone. Viewers see everything read-only (D019).
**Binding on the canvas implemented (2026-09-28):** the Add panel inserts a collection list whose
card (image, title, summary and a link to the entry's page) is designed once; the inspector sets
its collection, filters, sort, limit, skip and pagination. Texts, images with their alt text and
links inside a list or on a collection page read an entry field, with a date format for dates; a
field chip in the inspector and on the canvas selection label shows what is bound. New page can
make a page for each entry of a collection (`/<collection>/[slug]`, with the title, image and text
bound), the canvas bar switches the previewed entry and opens it in the CMS, and SEO title,
description and social image can come from fields. Paginated lists publish `<path>/page/2` onwards.
With no collections, the CMS panel starts a blog in one step (D020). A collection's settings also
create a list page at `/<collection>` whose cards link to the entry pages, and the link picker
offers every page and each entry of an entry page. Content editor mode, drafts and scheduling, and
CSV import remain.
**A chosen entry anywhere implemented (2026-09-28):** on any page, "From the CMS…" binds a text,
an image, its alt text or a link to a field of an entry picked by collection, search and field,
with a chip such as "Legal › Privacy › Body"; rich text renders its headings, lists and links as
blocks, page settings read the SEO title, description and social image from a chosen entry, and a
used entry, field or collection cannot be deleted (D021). Rich text holds tables (D022).
**Styling rich text implemented (2026-09-28):** a click on a heading, paragraph, link, list item,
cell or table inside a text that holds blocks, written or bound, selects "H2 in Legal body" and the
inspector styles that tag for every block with the class, per breakpoint and state; a list reaches
tags the content lacks, and a block without a class gets a preset on the first change (D023). A
bound date reads long, medium, numeric or ISO in the page's language or its own, a field can sit
inside a text ("Last updated: {date}"), and Site settings take a title template that every page's
title goes into unless it opts out (D024).

## Phase 5. Collaboration and scale

- Live collaboration: several people and their AI apps in one site at once (design below).
- Element comments.
- Background jobs and schedules.
- Postgres and S3 backends. Incremental builds.
- Localization.
- Code components and the plugin API.
- Template marketplace.

### Live collaboration: the design

Designed, not built. Several people edit one site at the same time and see each other, and an AI
app shows up as one more participant acting for the person who connected it.

- **Sync.** The server stays the single authority and orders batches. A batch based on an older
  revision is rebased instead of refused: positional arguments (insert and move indices, entry
  order) are mapped through the patches committed since, then the operations are planned again
  against the head. The same field written twice keeps the value ordered last. Operations,
  validation, dry runs and MCP keep their meaning (D026). A whole-document CRDT was considered and
  set aside, because a merge after validation can break invariants such as moving a node into a
  deleted parent.
- **Text.** At first one person types in a text at a time, under a short lease; others see who is
  typing and keep editing everything else. Character-level merging with Yjs inside rich text only
  may follow if leases prove too coarse.
- **Room and transport.** One in-memory room per open site holds the head document, presence and a
  batch log. Each editor tab keeps one WebSocket (replacing today's event stream) and updates
  optimistically, re-planning its pending batches when others' arrive. If a proxy blocks
  WebSockets the editor falls back to today's single-writer mode.
- **Presence.** Who is in the site and on which page, their selections outlined on the canvas and
  marked in the layers, in stable per-person colours.
- **Undo per person.** Undo takes back only your own batches and skips fields someone else has
  written since.
- **Roles and attribution.** Viewers watch live and read only; an AI app acts with the rights of
  the person who approved it and its batches land in that person's undo history only. A persisted
  batch log attributes every change to a person or to "app via person", and releases list who
  contributed.

Open questions include local members for self-hosted instances (today a Community instance has one
owner, D015), whether live text needs Yjs, and batch log retention.

## Future ideas

Not scheduled; recorded so they are not lost.

- Version history and restore: browsable draft snapshots distinct from releases, restorable
  without a publish.
- Fluid typography and spacing: a design token that is a scale (`clamp` between two sizes) rather
  than one value.
- Default template bound to its own tokens, so a new site shows tokens working from the first edit.
- Testing protection: a password or a private link for the testing origin.
- More direct manipulation on the canvas: corner radius handles, scrubbing typography values, and
  layout toggles on the selection's bar.

## Not planned

- Interactions timeline engine. Native CSS animation support instead, revisited on demand.
- Web app features: authentication for visitors, per-user state, dashboards.
- Model calls of any kind: no Lacuno-operated inference, no bring-your-own key, no provider
  settings. The user's own AI app connects through MCP.
- Proposals as branches with a rendered diff; the live canvas is the review.
