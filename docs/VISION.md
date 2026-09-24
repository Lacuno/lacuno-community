# Vision

## The problem

Webflow proved that designers want a visual tool that produces real HTML and CSS, with a CMS and
one-click publishing. It also proved the downsides: a proprietary document format, hosting you cannot
leave, pricing that scales against you, and an AI story bolted on from the outside.

The open source alternatives each miss a leg. Webstudio is the closest, but its builder is not
recommended for self-hosting in production, its output is a dynamic Remix or Vike app, it has no
native CMS, and its agent integration lives outside the builder. Onlook targets developers editing
React code. Puck and GrapesJS are libraries you embed, not products you run.

Nobody has shipped the combination: a Webflow-class visual editor, static-first output, a native CMS,
a real self-host story, and an agent that is a first-class collaborator rather than an API wrapper.

## What Miralo is

Miralo is a self-hostable, open source web design and publishing tool.

- You design visually with a real CSS model: classes, combo classes, breakpoints, states, design tokens.
- Your site is a typed JSON document that lives in a git repository you own.
- Publishing compiles that document to an Astro project and serves the static output. Zero JavaScript
  by default, islands when a component needs interactivity.
- A native CMS with collections, references and collection templates feeds the build.
- An agent works on the same document. On the canvas, as a chat panel that sees your selection and
  proposes visible changes. From the terminal, as an MCP server for Claude Code, Cursor or any agent.
  In the background, as jobs that write content, audit accessibility or translate pages.
- It runs on your server as one container.

## Who it is for

Primary: freelancers, small studios and indie founders who build marketing sites, portfolios, blogs
and documentation for themselves and for clients, and who want to own the result.

Secondary: developers who want a visual layer over an Astro site without giving up the codebase, and
teams that want an agent to draft and maintain sites under human review.

Not for: web apps with authentication, dashboards, or per-user state. Miralo builds sites, not apps.
An island can embed an app, but Miralo will not become one.

## Principles

1. **The document is the product.** A versioned, schema-defined JSON document is the single source
   of truth. The editor, the compiler, the agent and the API are all clients of it. If a feature
   cannot be expressed in the document, it does not exist.
2. **Honest CSS.** The style panel exposes real CSS. Generated CSS is readable, uses real class names,
   and could be handed to a developer without shame. No inline style soup, no utility class dumps.
3. **Static first.** The default output is HTML and CSS a CDN can serve. Every dynamic feature must
   justify its JavaScript.
4. **Own your site.** Git-backed documents, exportable Astro projects, standard assets. Leaving
   Miralo should be a `git clone`, not a migration project.
5. **Agents are users.** An agent gets the same document, the same permissions model, the same undo
   history and the same audit trail as a human. Its changes are proposals until a human accepts them,
   unless the human says otherwise.
6. **Self-hostable.** One application container, SQLite and local disk. Separate editor and publishing
   listeners keep site scripts away from authentication. Operators manage their own infrastructure.
7. **Open builder, optional managed hosting.** The builder, CMS, publishing and agent belong in the
   AGPL repository. Community includes self-hosting documentation; operators configure domains,
   HTTPS, backups and updates themselves. A future paid Cloud service manages that work for them.
8. **Parity is a test.** What you see on the canvas is what Astro emits. The canvas renderer and the
   compiler share one CSS generator and are snapshot-tested against each other.

## What success looks like

- A designer builds and publishes a five-page client site with a blog in an afternoon without
  reading docs.
- A developer deploys the application container and follows the self-hosting guide to connect their
  own reverse proxy, domains and TLS. No paid subscription is required to self-host.
- A founder types "build me a landing page for a bookkeeping SaaS, use our brand skill" and gets a
  proposal on the canvas they can accept, tweak or reject section by section.
- Claude Code, pointed at the MCP server, adds a pricing page that respects the site's design tokens and
  components, screenshots it, and opens a proposal branch for review.
- A published page scores 100 on Lighthouse performance with no effort from the user.
