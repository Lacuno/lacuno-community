# The agent layer

Lacuno treats agents as collaborators, not as a feature. The agent is whichever AI app the user
already pays for: Claude, ChatGPT, Cursor, VS Code and the rest. Lacuno never calls a model and
never holds an API key. It gives the user's app hands: a document it can read and write, tools to
look at the result, and a canvas where the designer watches it work.

## Principles

1. **Same document, same rules.** An agent reads and writes the same document as the editor, under
   the permissions of the user who connected it, with every change in the activity log.
2. **Live on the canvas.** Agent edits land in the open editor as they happen. The designer sees
   each batch arrive, can keep editing next to it, and can undo their own steps. The canvas is
   the review; there is no separate proposal flow.
3. **Vocabulary above CSS.** The agent works with roles, archetypes, design tokens and components
   before it works with pixels. The document supports that vocabulary natively.
4. **The agent can look.** Every agent surface has preview, screenshot and diff tools. An agent
   that cannot see its result produces worse results.
5. **Bring your own app, not your own key.** The user's subscription does the thinking. No
   provider settings, no keys, no Lacuno-operated inference.

## Surfaces

### Connect your AI

The editor's **Connect your AI** button registers the site's MCP endpoint in the app of the
user's choice: an install link where the app has one, a one-line command or a URL to paste where
it does not, then an OAuth consent screen in Lacuno. Once connected, the editor shows the app's
name, when it last acted, and each batch it applies; touched elements flash on the canvas. See the
[design](superpowers/specs/2026-09-23-connect-your-ai-design.md).

- **Remote MCP** over Streamable HTTP on the Community server, one endpoint per site, protected by
  OAuth issued by the same server that runs the editor.
- **Localhost works** for desktop and CLI apps. Cloud-hosted apps (claude.ai, ChatGPT) need a
  public address, which Cloud runtimes have.
- **Selection context** (Phase 3): the agent can read which page, breakpoint and element are
  open in the editor and act on "this element".

### MCP over stdio

`lacuno mcp <dir>` serves the same tools over stdio for a site folder, for agents that work
from a repository without a server, and for building templates.

### MCP tools

- **Progressive discovery.** Agents start with `guide` for the document model and workflow, then
  call it again with a `group` argument for the operation schemas of one group at a time, instead
  of loading every operation schema up front.
- **Reading.** `document.read`, `page.outline`, `node.get`, `styles.get`, `entries.list`, plus
  the document schema and operations schema as resources.
- **Writing.** `document.apply` with version pinning: every write names the document version it
  read, and a stale write is rejected with the current version so the agent re-reads and retries
  instead of overwriting. Dry run returns the resulting diff without applying it.
- **Looking.** `page.preview` returns a route's HTML as published, or its visible text with node
  ids; `page.screenshot` returns a PNG of a route or a node through an optional Playwright
  Chromium; `document.diff` summarises a dry-run batch or the changes since another document.
- **Assets and publishing.** `asset.import` uploads a file; `site.build` builds a folder over
  stdio, and over the connected endpoint `site.publish` builds to the testing origin so the agent
  can show its result.
- **Bindings.** A node attribute, a bound text value and a component prop each hold a binding:
  `static`, `field`, `designToken`, `asset`, `prop` or `page`. A `page` binding names a page id and
  compiles to that page's path, so a link survives a path change; deleting a referenced page is
  refused with the referencing node ids.

## Skills

A skill is a markdown file with frontmatter, stored in the site repository under `skills/`.

```markdown
---
name: brand
description: Voice, palette usage and layout rules for Acme
applies: always
---
Acme sounds confident and plain. No exclamation marks. Headlines under eight words.
Use `color.brand` only for primary actions. Sections alternate `surface.default` and
`surface.muted`. Hero sections use the `hero-split` component.
```

- `applies: always` skills are exposed as MCP resources and named in `guide`, so a connected app
  reads them before it works. Others load on demand.
- Skills can include example documents: a section archetype with a node subtree the agent should
  reuse rather than reinvent.
- Skills are plain files, so they version with the site, fork with templates and can be shared.
- Lacuno ships default skills: responsive fixes, accessibility, copywriting, component
  extraction, collection schema design, SEO.

## Semantic vocabulary

Nodes can carry optional annotations that cost nothing in output and help agents and tools:

- `role`: `hero`, `nav`, `pricing`, `testimonial`, `cta`, `footer`, `feature-grid`, and free-form.
- `archetype`: which section pattern this instance follows, linking back to a skill example.
- `constraints`: `above-fold`, `keep-order`, `no-restyle`, `content-only`. The agent must respect
  them and the linter flags violations.

The design linter uses the same vocabulary: a page without a `hero` role, a `cta` with low
contrast, a `pricing` section that breaks at tablet width. An agent runs it before handing over.

## Safety and limits

- Every tool call is logged with the connected app, the user who connected it and the resulting
  diff, and shows up in the editor's activity list.
- Connections are per site and revocable from the editor. A token only ever grants one site.
- Agents cannot change permissions, invite users, delete sites or publish to production. Those
  are human-only actions and are not exposed as tools.
- Rate limits per connection.

## What ships when

| | When |
| --- | --- |
| MCP server with discovery, nodes, styles, design tokens, pages, dry run, version pinning | Done |
| Preview, screenshot, diff | Done |
| Connect your AI: remote endpoint, OAuth, app cards, connection badge, live view, activity | Phase 2 |
| Uploads and publish to testing through the connected endpoint | Phase 2 |
| Selection context through MCP | Phase 3 |
| Skills, default skill set, semantic annotations, linter | Phase 3 |
| Element comments the agent can read | Later |
