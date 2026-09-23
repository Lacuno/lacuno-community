# The agent layer

Freeflow treats agents as collaborators, not as a feature. This document describes what that means
in practice and what we build to make it true.

## Principles

1. **Same document, same rules.** An agent reads and writes the same document as the editor,
   under the permissions of the user who invoked it, with every change in the audit log.
2. **Show, don't apply.** Agent work lands as a proposal the human can see rendered on the canvas
   and accept, edit or reject. Direct mode exists behind an explicit opt-in per site.
3. **Vocabulary above CSS.** The agent works with roles, archetypes, design tokens and components before
   it works with pixels. The document supports that vocabulary natively.
4. **The agent can look.** Every agent surface has screenshot and diff tools. An agent that cannot
   see its result will produce worse results.
5. **Bring your own model.** Any provider with a key, or a local model through Ollama. The instance
   owner chooses; no Freeflow-operated inference is required.

## Surfaces

### In-app agent panel

A chat panel inside the editor.

- **Context it always has:** the current page, breakpoint, selection, the site's design tokens and
  components, the site's skills, and a compact outline of the page.
- **Context it can ask for:** any node subtree, any collection schema and sample entries, the
  generated CSS for a node, a screenshot of any node or viewport, comments on any element.
- **What it produces:** a proposal. The canvas shows the proposal rendered, with changed nodes
  highlighted and a before-and-after toggle. Accept applies it as one undo step and one commit.
  Accepting part of a proposal is supported at the section level.
- **Element conversations.** Pin a comment to a node and mention the agent. "Make this section
  breathe more" is scoped to that node. Comments are a shared surface for humans and agents.
- **Slash commands** for the common skills: `/section`, `/responsive`, `/extract-component`,
  `/copy`, `/a11y`, `/schema`.

### MCP server

The same tool set, exposed for external agents such as Claude Code, Cursor and Codex.

- Available over streamable HTTP on the instance and over stdio through the CLI.
- **Progressive discovery.** Agents start with `guide` for the document model and workflow, then
  call it again with a `group` argument for the operation schemas in one group at a time, instead
  of loading every operation schema up front.
- **Phase 0 tools.** `guide`, `document.read`, `page.outline`, `node.get`, `styles.get`,
  `entries.list`, `document.apply`, `asset.import` and `site.build`, plus the document schema and
  operations schema resources.
- **Preview tools.** `page.preview` returns a route's HTML as published, or its visible text with
  node ids; `page.screenshot` returns a PNG of a route or a node through an optional Playwright
  Chromium; `document.diff` summarises a dry-run batch or the changes since another document file.
- **Bindings.** A node attribute, a bound text value and a component prop each hold a binding:
  `static`, `field`, `designToken`, `asset`, `prop` or `page`. A `page` binding names a page id and
  compiles to that page's path, so a link survives a path change; deleting a referenced page is
  refused with the referencing node ids.
- **Version-pinned mutations.** Every write names the document version it read. A stale write is
  rejected with the current version so the agent re-reads and retries instead of overwriting.
- **Dry run** on every mutating tool returns the resulting diff without applying it.
- **Proposal tools.** `proposal.open`, `proposal.add`, `proposal.screenshot`, `proposal.submit`.
  An external agent works in a proposal branch exactly like the in-app agent. Direct mode is a
  capability granted to a token, not a default.
- **Preview and vision.** `preview.start` builds the current proposal and serves it. `screenshot`
  captures a page or node at a viewport. `screenshot.diff` compares against the base branch and
  returns changed regions and text.
- **Resources.** The document schema, the site's skills, the component catalog and the design token set
  are exposed as MCP resources so agents can read them without tool calls.

### Background jobs

Long-running agent work that no human is watching in real time.

- Examples: generate entries for a collection from a brief, translate all pages into a locale,
  nightly accessibility and performance audit with a report, regenerate OG images after a design token
  change, rewrite alt text for every image.
- Jobs run on the server with the instance's configured provider, produce a proposal or a report,
  and notify through email or webhook.
- Jobs are defined as skills with a schedule or a trigger. Users see progress, logs and cost.

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

- `applies: always` skills load into every agent context for the site. Others load on demand or
  by slash command.
- Skills can include example documents: a section archetype with a node subtree the agent should
  reuse rather than reinvent.
- Skills are plain files, so they version with the site, fork with templates and can be shared.
- Freeflow ships default skills: responsive fixes, accessibility, copywriting, component
  extraction, collection schema design, SEO.

## Semantic vocabulary

Nodes can carry optional annotations that cost nothing in output and help agents and tools:

- `role`: `hero`, `nav`, `pricing`, `testimonial`, `cta`, `footer`, `feature-grid`, and free-form.
- `archetype`: which section pattern this instance follows, linking back to a skill example.
- `constraints`: `above-fold`, `keep-order`, `no-restyle`, `content-only`. The agent must respect
  them and the proposal review flags violations.

The design linter uses the same vocabulary: a page without a `hero` role, a `cta` with low
contrast, a `pricing` section that breaks at tablet width.

## Proposals

Proposals are the unit of agent work and of human branching.

- A proposal is a git branch off the site's current commit plus a description and a preview build.
- The editor shows a proposal as a rendered diff: changed nodes highlighted, added sections
  outlined, removed ones ghosted, with before-and-after per breakpoint.
- Review actions: accept all, accept section, edit in place then accept, request changes with a
  comment, reject.
- Accepting merges the branch, applies it to the live Yjs document as one undo step, and records
  the author as the agent plus the reviewing human.
- Humans use the same mechanism for their own branches, so the review UI is exercised constantly
  and not only by agent work.

## Model providers

- Anthropic, OpenAI-compatible endpoints and Ollama at launch. Provider is chosen per instance,
  overridable per workspace.
- Keys are encrypted at rest. Usage and cost are tracked per site and per job.
- Prompts and tool schemas are versioned in the repository, not hidden in a service.

## Safety and limits

- Every tool call is logged with the user, the token, the input and the resulting diff.
- Rate limits per token. Budget caps per job.
- Agents cannot change permissions, invite users, delete sites or rotate keys. Those are human-only
  actions and are not exposed as tools.
- Published output from a proposal is served only on preview URLs until a human accepts.

## What ships when

| | When |
| --- | --- |
| MCP server with discovery, nodes, styles, design tokens, pages, dry run, version pinning | MVP |
| Preview, screenshot, screenshot diff | MVP |
| Proposals as branches, review in the editor | Next |
| In-app agent panel with selection context | Next |
| Skills, default skill set, semantic annotations, linter | Next |
| Background jobs and schedules | Later |
| Element comments with agent mentions | Later |
