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

## Overview

| Phase | Goal | Status |
| --- | --- | --- |
| 0. Foundation | The document, the compiler and an agent produce a real site | Complete |
| 1. Editor MVP | A designer builds and publishes a site without the terminal | Built; `npx lacuno` open |
| 2. Connect your AI | The user's own AI app works on the canvas, live | Built |
| 3. Agent on the canvas | The agent works with the designer's context | Not started |
| 4. Content and forms | Collections, content editing, forms, imports | CMS built; forms and imports open |
| 5. Collaboration and scale | Several people and their AI apps in one site | Designed, not built |

## Phase 0. Foundation — complete

Goal: the document, the compiler and an agent can produce a real site before there is an editor.

- `packages/schema`: document schema, validation, migrations, fixtures.
- `packages/css`: deterministic CSS generator with snapshot tests.
- `packages/document`: named operations over the document, primitive patches, a store with a
  revision counter, dry runs and atomic persistence to a site folder.
- `packages/compiler` and `apps/cli`: document to static output through Astro as an internal
  engine. `lacuno build <dir>` builds a site folder; a Lighthouse script guards the score.
- `packages/mcp` and `lacuno mcp`: a stdio server with `guide`, `document.read`, `page.outline`,
  `node.get`, `styles.get`, `entries.list`, atomic `document.apply` with dry run and version
  pinning, `asset.import`, `site.build`, and JSON Schema resources, operating on a site folder.
- The default template, written through the MCP stdio server.

**Exit, demonstrated:** an MCP client authored the default document through the real stdio server:
design tokens, shared components, three pages, a collection template, three entries and an asset,
with no model provider involved. The CLI built six static routes with no warnings; browser checks
covered desktop, mobile and 320px widths (navigation, headings, focus, contrast, overflow), and all
six routes scored 100 for Lighthouse performance. `lacuno build` writes portable files to `dist/`;
it does not publish them.

## Phase 1. Editor MVP

Goal: a designer can build and publish a site without touching the terminal.

**Server** ([apps/server](../apps/server/README.md))

- Email and password sessions, a private workspace per user, sites created from the default
  template, and authenticated, version-pinned document operations; SQLite for documents, sessions
  and rate limits.
- First-run owner setup protected by a one-time token; registration closes once the owner exists.

**Editor** ([apps/editor](../apps/editor/README.md))

- A sandboxed canvas rendered by the compiler, a layer tree, page and entry previews, widths and
  zoom, and a focus mode.
- Element palette: headings, paragraphs, spans, lists, images, video, sections, containers, links,
  buttons and HTML embeds; wrap a selection in a link; sibling order and structure edits keep ids.
- Styling in the inspector's groups (Layout, Size, Spacing, Typography, Colors, Effects, Motion),
  which remember being opened or closed; classes, breakpoints and states (hover, focus,
  focus-visible, active, visited, first, last, odd, even), with the canvas showing the picked state.
- Visual layout controls: Flow, Row, Stack and Grid, grid columns and ratios, alignment, gaps, and
  item width inside a layout.
- On the canvas: size handles, and a Spacing mode with padding and margin handles and their values.
- Design tokens for colour, spacing, size, typography, radius and shadow, bound from any matching
  field; the canvas handles snap to tokens.
- Links and buttons whose destination can be a page, so a link follows a page to a new path.
- Pages and SEO: site name, public URL, language, favicon, site-wide code, redirects, canonical
  URLs, hiding from search engines, social images and a `/404` page.
- Fonts: uploaded WOFF2, WOFF, TTF and OTF files, self-hosted in the published site, or system
  fonts; nothing is loaded from a third party (D013).
- Components with props.
- Undo and redo of saved batches, and History beside them listing recent edits by you and your AI
  apps.

**Publishing**

- Immutable release snapshots, build status and errors, a separate origin for published sites,
  release history with names, and rollback without touching the draft; a failed build keeps the
  live site.
- Testing: publish to `<site-id>-testing.<publishing base>` (not indexed), promote a testing
  release to production without a rebuild, or send any release to testing.

**MCP:** `page.preview` (a route's published HTML or its text), `page.screenshot` (a PNG through
Playwright's Chromium, an optional dependency) and `document.diff`.

**Open**

- `npx lacuno` as a one-command start; today it is the Docker image and the self-hosting guide.
- Folders, page templates, generated social images and a 500 page.
- Slots and visible instance overrides for components moved to Phase 4, to be built with the CMS.
- Git history and realtime sync are not built; undo is by inverse patches. Collaboration is
  Phase 5.
- Deferred to Future ideas: version history with restore, fluid type and spacing scales, and the
  default template bound to its own tokens.

**Exit:** a five-page site with components, design tokens and dark mode, built in the editor,
published and rolled back from the container. An operator can deploy it with their own domain and
TLS using the self-hosting guide; managed domains and TLS are Cloud work, not a Community
requirement.

## Phase 2. Connect your AI

Goal: the differentiator. A designer connects the AI app they already pay for to a site in one
click and watches it work on the canvas. Lacuno never calls a model and never holds an API key;
the user's own subscription does the thinking, Lacuno gives it hands.

**Built**

- A remote MCP endpoint per site, `/mcp/:id`, serving the existing tools over Streamable HTTP
  behind OAuth issued by the same server: a consent page in the editor, dynamic client
  registration and Client ID Metadata Documents, one site per token.
- **Connect your AI** in the editor header: cards for Claude Code, claude.ai, Claude Desktop,
  ChatGPT, Cursor, VS Code, Codex CLI and Gemini CLI, each with the registration that app
  documents, and a list of connections with their last activity and Disconnect.
- Live view: committed batches stream to the open editor over server-sent events and land on the
  canvas with a flash, queued behind the designer's own save; each agent batch is one undo step,
  and History names who did what.
- Uploads through MCP as inline data or a one-time upload address, and `site.publish` to testing.
- Connections survive signing out; gateway mode serves the OAuth, metadata and MCP routes for
  Cloud, which may also connect as the signed-in user ([gateway protocol](GATEWAY_AUTH.md)).

**Open:** custom-scheme redirect URIs are refused by the OAuth provider.

**Exit:** from a fresh site, click Connect your AI, pick Claude, approve once, and ask it for a
pricing page in the site's tokens and components. The page appears in the editor while Claude
builds it, the connection shows Claude working, and one section is then edited by hand and
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

Goal: the reasons people pay for Webflow. Deferred behind the AI work: an agent already writes
content through the document, so native content editing could wait.

**Built**

- The CMS panel and dialog: collections and their fields (with options, reference targets and the
  slug field), and entries in a table that sorts, searches and pages. The entry form has an input
  per field type, including rich text with tables, assets, dates and references. Deleting what is
  used is refused and names where it is used; viewers see everything read-only (D019).
- Collection lists on the canvas, designed once per card, with filters, sort, limit, skip and
  pagination (`<path>/page/2` onwards).
- Binding: texts, images, alt texts and links read an entry field inside a list, on a collection
  page (`/<collection>/[slug]`), or from a chosen entry anywhere ("From the CMS…", D021); fields
  can sit inside a text, dates have formats in the page's language, and SEO fields can come from
  entries.
- A blog in one step when a site has no collections (D020), and a list page per collection.
- Styling the blocks of rich text per tag, breakpoint and state (D023), and a site-wide title
  template (D024).

**Open**

- Content editor mode, roles, drafts and scheduling.
- Components with slots and visible instance overrides in the layer tree.
- Forms with submissions, notifications and webhooks.
- Import from a Webflow clipboard, Webstudio JSON, HTML with CSS, Tailwind HTML and CSV.
- Export of the static output to a git remote, and deploy hooks for external hosts.

**Exit:** a blog with fifty posts and a contact form, imported from a Webflow export, published
and receiving submissions.

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
- Model calls of any kind in Community: no Lacuno-operated inference, no bring-your-own key, no
  provider settings. The user's own AI app connects through MCP.
- Proposals as branches with a rendered diff; the live canvas is the review.
