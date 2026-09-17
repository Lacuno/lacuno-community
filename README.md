# Freeflow

**An open source, self-hostable web design tool with an agent built in.**

Design visually like Webflow. Publish blazing-fast static sites built by Astro. Let AI agents work
alongside you on the same document, on the canvas and from the terminal. Run it all on your own server
with one command.

> Status: pre-alpha. Phase 0 is complete: the schema, document operations, CSS generator, static
> compiler, CLI, stdio MCP server and default template are working. A first visual editor is now
> available; the full Editor MVP and hosted service remain in progress. Start with [docs/VISION.md](docs/VISION.md).

Phase 1 now has a [server foundation](apps/server/README.md): email/password sessions, private
workspaces, template-based site creation, and persistent document editing through an HTTP API.
The [visual editor](apps/editor/README.md) adds a canvas, layer tree, page previews and basic text/style
editing. Run `pnpm setup:env` and `pnpm dev`, then open `http://localhost:3000`.

## Documents

| Doc | What it covers |
| --- | --- |
| [docs/VISION.md](docs/VISION.md) | Why Freeflow exists, who it is for, the principles we will not compromise on |
| [docs/FEATURES.md](docs/FEATURES.md) | The full feature map, what ships when, and what we deliberately defer |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data model, compiler, editor, server, storage, publishing, tech stack |
| [docs/AGENTS.md](docs/AGENTS.md) | The agent layer: in-app agent, MCP, skills, proposals, safety |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases and milestones |
| [docs/LANDSCAPE.md](docs/LANDSCAPE.md) | What Webstudio, Webflow, Framer, Onlook, Plasmic and Puck do, and where we differ |
| [docs/STACK.md](docs/STACK.md) | Pinned technology choices with reasons and fallbacks |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log. Every big call, the alternatives, and why |
| [templates/freeflow/README.md](templates/freeflow/README.md) | Copy, customize and build the runnable default template |

## The pitch in five lines

1. **Self-hosted.** One Docker image, SQLite, local or S3 assets, Caddy for TLS. `docker run` and you are live.
2. **Open source.** The builder, the compiler, the CMS, the agent, the publishing pipeline. No open-core trapdoor.
3. **Great UX.** A real CSS editor with classes, breakpoints, states and design tokens. It teaches the box model instead of hiding it.
4. **Agentic.** An agent on the canvas that proposes changes you can see, plus an MCP server so Claude Code or any agent edits the same document.
5. **Blazing fast.** The document compiles to an Astro project. Static HTML, zero JavaScript by default, islands when you need them.

## License

AGPL-3.0-or-later for the whole project. See [docs/DECISIONS.md](docs/DECISIONS.md) for the reasoning.

## Working on Freeflow

```sh
pnpm install
pnpm check        # lint, typecheck, tests
pnpm test         # tests only
pnpm setup:env    # prepare local server settings; preserves an existing .env
pnpm dev         # start the API with settings from .env
```

Node 22 and pnpm 10. The stack and the reasons behind it are in [docs/STACK.md](docs/STACK.md).

### Repository layout

```
packages/schema     Document schema, validation and fixtures
packages/document   Versioned operations, dry runs and atomic site-folder persistence
packages/css        The document-to-stylesheet generator
packages/compiler   The document-to-static-site compiler, using Astro internally
packages/mcp        MCP tools and resources over the document and compiler
apps/cli            The `freeflow build` and `freeflow mcp` commands
apps/server         Authenticated HTTP API with SQLite document persistence
apps/editor         React editor with canvas selection and text/style editing
packages/renderer   Canvas HTML using the shared compiler and CSS generator
templates/freeflow  Runnable default site, source asset and usage instructions
scripts/            Smoke and Lighthouse checks
docs/               Vision, features, architecture, agents, roadmap and decisions
```

Phase 0 is complete. An MCP client authored the default template through the provider-independent
stdio server, the CLI generated its six static routes, responsive and keyboard browser checks passed,
and every route scored 100 in the Lighthouse performance category. See
[the template instructions](templates/freeflow/README.md) to run it and [the roadmap](docs/ROADMAP.md)
for the demonstrated exit criteria and planned editor work.
