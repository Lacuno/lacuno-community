# Lacuno

**An open source, self-hostable web design tool with an agent built in.**

Design visually like Webflow. Publish blazing-fast static sites built by Astro. Let AI agents work
alongside you on the same document, on the canvas and from the terminal. Run it all on your own server
on infrastructure you control.

> Phase 0 is complete: the schema, document operations, CSS generator, static
> compiler, CLI, stdio MCP server and default template are working. A first visual editor is now
> available; the full Editor MVP and hosted service remain in progress. Start with [docs/VISION.md](docs/VISION.md).

Phase 1 now has a [server foundation](apps/server/README.md): email/password sessions, private
workspaces, template-based site creation, and persistent document editing through an HTTP API.
The [visual editor](apps/editor/README.md) adds a canvas, layer tree, page previews and basic text/style
editing. Run `pnpm setup:env` and `pnpm dev`, then open `http://localhost:3000`.
On a new private instance, run `pnpm owner:token` in another terminal and use the one-time token
to create your owner account. Registration closes automatically afterward.

For Docker deployment, follow the [self-hosting guide](docs/SELF_HOSTING.md). Community provides
the builder and publishing; you manage domains, HTTPS, backups and updates. A future paid Cloud
service will handle those operations for you. No Cloud service is available yet.

## Documents

| Doc | What it covers |
| --- | --- |
| [docs/VISION.md](docs/VISION.md) | Why Lacuno exists, who it is for, the principles we will not compromise on |
| [docs/FEATURES.md](docs/FEATURES.md) | The full feature map, what ships when, and what we deliberately defer |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data model, compiler, editor, server, storage, publishing, tech stack |
| [docs/AGENTS.md](docs/AGENTS.md) | The agent layer: in-app agent, MCP, skills, proposals, safety |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases and milestones |
| [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) | Docker setup, operator-managed HTTPS, backups, restore and updates |
| [docs/LANDSCAPE.md](docs/LANDSCAPE.md) | Competitor research: Webstudio, Webflow, Framer, Base44 and others; where we differ |
| [docs/STACK.md](docs/STACK.md) | Pinned technology choices with reasons and fallbacks |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decision log. Every big call, the alternatives, and why |
| [templates/lacuno/README.md](templates/lacuno/README.md) | Copy, customize and build the runnable default template |

## The pitch in five lines

1. **Self-hosted.** One application container, SQLite and filesystem assets. You configure your own domains and HTTPS.
2. **Open source.** The builder, the compiler, the CMS, the agent, the publishing pipeline. No open-core trapdoor.
3. **Great UX.** A real CSS editor with classes, breakpoints, states and design tokens. It teaches the box model instead of hiding it.
4. **Agentic.** An agent on the canvas that proposes changes you can see, plus an MCP server so Claude Code or any agent edits the same document.
5. **Blazing fast.** The document compiles to an Astro project. Static HTML, zero JavaScript by default, islands when you need them.

## License

AGPL-3.0-or-later for the whole project. See [docs/DECISIONS.md](docs/DECISIONS.md) for the reasoning.

## Operator backups

After building the server, its offline operator tool can snapshot a running instance without
stopping the editor or published-site listener:

```sh
node apps/server/dist/backup-cli.js backup /absolute/live-data /absolute/new-backup
node apps/server/dist/backup-cli.js verify /absolute/new-backup
node apps/server/dist/backup-cli.js restore /absolute/new-backup /absolute/empty-restored-data
node apps/server/dist/backup-cli.js import /absolute/lacuno-export.zip /absolute/empty-data
```

`import` reads a workspace exported from Lacuno Cloud, a zip with such a backup, with the same
checks as `restore` ([Moving from Lacuno Cloud](docs/SELF_HOSTING.md#moving-from-lacuno-cloud)).

The SQLite online snapshot contains drafts, accounts, release history and publication pointers.
The tool copies referenced immutable assets and every ready release's published output, then writes
a checksummed completion manifest. Unfinished builds become failed in the restored snapshot and can
be published again. Temporary build files and unreferenced uploads are not included. This relies on
the current no-pruning policy for immutable assets/releases; future garbage collection must coordinate
with backups. A missing file or bad checksum fails the backup rather than producing a partial success.

Restore verifies the complete inventory and SQLite integrity and only writes to an empty directory.
It does not replace or restart a live instance. Use the same server version and preserve the original
environment/secrets separately; managed gateway instances also require the same issuer and audience.
Backups contain sensitive account and site data, are not encrypted, and are not a substitute for
off-host storage. Treat only operator-owned backups as trusted: checksums detect corruption, not forgery.

## Working on Lacuno

For maintenance tooling, `node apps/server/dist/published-main.js` runs only the published-site
listener against an existing database opened read-only. Set `LACUNO_DATA_DIR`,
`LACUNO_PUBLISH_BASE_URL`, `LACUNO_PUBLISH_PORT` and `HOST` explicitly. It does not migrate data,
run builds, expose the editor or accept authenticated management requests. `--list` prints the
current site/release IDs for operator health checks. The normal server reuses the same publication
reader and file-serving rules. This process can serve existing releases while an editor runtime is
stopped for a controlled upgrade; mount its data read-only and keep it isolated from management traffic.

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
apps/cli            The `lacuno build` and `lacuno mcp` commands
apps/server         Authenticated HTTP API with SQLite document persistence
apps/editor         React editor with canvas selection and text/style editing
packages/renderer   Canvas HTML using the shared compiler and CSS generator
templates/lacuno  Runnable default site, source asset and usage instructions
scripts/            Smoke and Lighthouse checks
docs/               Vision, features, architecture, agents, roadmap and decisions
```

Phase 0 is complete. An MCP client authored the default template through the provider-independent
stdio server, the CLI generated its six static routes, responsive and keyboard browser checks passed,
and every route scored 100 in the Lighthouse performance category. See
[the template instructions](templates/lacuno/README.md) to run it and [the roadmap](docs/ROADMAP.md)
for the demonstrated exit criteria and planned editor work.
