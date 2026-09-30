# Lacuno

**A visual website builder that publishes static sites, works with the AI apps you already use, and
runs on your own server.**

Lacuno is for designers and small studios who build marketing sites, portfolios, blogs and
documentation. You design on a canvas with real CSS: classes, breakpoints, states and design tokens,
plus a built-in CMS. Publishing compiles the site to static HTML and CSS; a page carries a small
script only for the features it uses, such as entrance animations.

Lacuno never calls a model and never holds an API key. **Connect your AI** adds the site to Claude,
ChatGPT, Cursor, VS Code or another MCP client with one approval, and that app's edits appear on
the canvas while it works. You keep editing next to it, and each of its changes is one undo step.

This repository is **Lacuno Community**: the whole builder, open source under the AGPL, to run
yourself. **[Lacuno Cloud](https://lacuno.io)** is the hosted service: the same editor with
hosting, domains and updates taken care of.

## Quick start

With Node 22 and pnpm 10:

```sh
pnpm install
pnpm setup:env    # writes .env with local defaults and a random auth secret; keeps an existing one
pnpm dev          # builds the editor and starts the server
```

Open `http://localhost:3000`. A new instance asks for a one-time setup token before it creates the
owner account. Print it in a second terminal:

```sh
pnpm owner:token
```

Registration closes once the owner exists. Create a site from the default template, edit it, and
publish: locally, sites are served at `http://<site-id>.localhost:3001`.

To connect an AI app, open **Connect your AI** in the editor. Desktop and command-line apps work
with a local instance; claude.ai and ChatGPT need a public address.

## Self-hosting

Lacuno runs as one container with SQLite and files on a volume, and a separate listener for
published sites. You provide DNS, a reverse proxy with HTTPS, backups and updates. The
[self-hosting guide](docs/SELF_HOSTING.md) covers Docker Compose, public deployment, backup and
restore, moving a workspace out of Lacuno Cloud, and upgrades.

## Documentation

| Doc | What it covers |
| --- | --- |
| [docs/VISION.md](docs/VISION.md) | Why Lacuno exists, who it is for, the principles |
| [docs/FEATURES.md](docs/FEATURES.md) | The feature map: what is in, what comes next, what is deferred |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases, what each delivered, and what is planned |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Document model, operations, compiler, canvas, server |
| [docs/AGENTS.md](docs/AGENTS.md) | Connect your AI, the MCP tools, safety |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log: every big call, the alternatives and why |
| [docs/STACK.md](docs/STACK.md) | Technology choices with reasons and fallbacks |
| [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) | Docker setup, operator-managed HTTPS, backups, restore and updates |
| [docs/GATEWAY_AUTH.md](docs/GATEWAY_AUTH.md) | Gateway mode, for a trusted proxy that authenticates users |
| [docs/CLOUD.md](docs/CLOUD.md) | Where Community ends and Lacuno Cloud begins |
| [docs/LANDSCAPE.md](docs/LANDSCAPE.md) | Notes on related products and where Lacuno differs |
| [apps/server/README.md](apps/server/README.md) | Server settings, HTTP API and publishing |
| [apps/editor/README.md](apps/editor/README.md) | The editor, feature by feature |
| [packages/mcp/README.md](packages/mcp/README.md) | The MCP tools and resources |
| [templates/lacuno/README.md](templates/lacuno/README.md) | The default template: copy, customise and build it |

## Working on Lacuno

```sh
pnpm check        # lint, typecheck and tests
pnpm test         # tests only
pnpm lacuno build <site-folder>   # build a site folder to static output
pnpm --silent lacuno mcp <site-folder>   # serve a site folder to an MCP client over stdio
```

```
apps/server         Hono server: editor, API, MCP endpoint, builds and the published-site listener
apps/editor         React editor: canvas, layers, inspector, CMS, publishing, Connect your AI
apps/cli            `lacuno build` and `lacuno mcp` over a site folder
packages/schema     Document schema, validation and fixtures
packages/document   Operations, dry runs, revisions and persistence
packages/css        The document-to-stylesheet generator
packages/compiler   The document-to-static-site compiler, with Astro as an internal engine
packages/renderer   Canvas HTML from the compiler and the CSS generator
packages/mcp        MCP tools and resources over the document and compiler
templates/lacuno    The default site new sites start from
scripts/            Environment setup, smoke and Lighthouse checks
docs/               Vision, features, roadmap, architecture and decisions
```

## License

AGPL-3.0-or-later for the whole project, with no open-core split. See [LICENSE](LICENSE), and
decisions D010 and D014 in [docs/DECISIONS.md](docs/DECISIONS.md) for the reasoning.
