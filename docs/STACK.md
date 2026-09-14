# Technology stack

Pinned September 2026. Every choice has a reason and a fallback. Upgrade deliberately, one thing at
a time, with the test suite green.

## Runtime and tooling

| Concern | Choice | Why | Fallback |
| --- | --- | --- | --- |
| Runtime | Node 22 LTS | Astro, better-sqlite3 and Playwright are best supported here. Bun is faster to start but its Node compatibility gaps show up exactly in native modules and workers | Node 24 when it is the active LTS |
| Package manager | pnpm 10 with workspaces | Strict node_modules, fast, the norm for TypeScript monorepos | |
| Task runner | Turborepo 2 | Caches builds and tests per package, simple pipeline config | Plain pnpm scripts if it ever gets in the way |
| Language | TypeScript 5.9, strict, `verbatimModuleSyntax`, ESM only | TypeScript 7 (the native port) shipped this year but the plugin ecosystem is still catching up. We move when Vite, Vitest and tsdown all support it | TypeScript 7 |
| Lint and format | Biome 2 | One fast tool instead of ESLint plus Prettier plus a dozen plugins | |
| Tests | Vitest 5 | Vite-native, workspaces, snapshot support, browser mode when we need DOM | |
| E2E | Playwright | Editor flows and canvas parity tests. Chromium is preinstalled in our CI image | |
| Package builds | tsdown | Rolldown-based, fast, produces ESM plus types. Only the CLI and server are bundled; workspace packages are consumed from source | tsup |

## Core packages

| Concern | Choice | Why |
| --- | --- | --- |
| Schema | Zod 4 | Runtime validation, inferred types, JSON Schema export for MCP tool inputs. The document schema is the contract for every other package |
| Live document | Yjs | Undo and redo, multiplayer and agent co-editing from one CRDT. Serialized to JSON for git |
| CSS generation | Our own, no dependency | Deterministic output is the whole point. Uses `lightningcss` for minification at build time only |
| Site output | Astro 7 | Static by default, islands when needed, content collections, image service, view transitions. The best static generator for content sites and it keeps improving |
| Image processing | sharp, through Astro | Responsive sizes, AVIF and WebP |

## Server

| Concern | Choice | Why |
| --- | --- | --- |
| HTTP | Hono 4 | Small, fast, typed routes with a generated client, runs on Node today and on other runtimes if we ever want that |
| Database | SQLite via better-sqlite3, WAL mode | Zero-service self-hosting. Postgres via the same Drizzle schema when a deployment needs it |
| ORM and migrations | Drizzle | Typed SQL, plain migration files, SQLite and Postgres from one schema |
| Auth | better-auth | Email and password, magic links, OIDC, sessions, all self-hosted |
| Realtime | ws plus y-websocket protocol | Yjs sync and presence over one WebSocket per open site |
| Git | isomorphic-git or a thin wrapper around the git binary | Sites are repositories. Start with the binary in the container for correctness, revisit if we need pure JS |
| Build queue | In-process worker threads | Runs the compiler and `astro build`. A separate worker process is a config option later |
| Email | Nodemailer with SMTP, Resend as an adapter | Form notifications, magic links |
| TLS and domains | Caddy | Automatic certificates and host-based routing, configured through its admin API from the server |
| Container | Distroless-style Node image, single process, one volume | `docker run -v data:/data -p 80:80 freeflow` |

## Editor

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | React 19 with Vite | The editor tooling ecosystem lives here: Radix, dnd-kit, Tiptap, Yjs bindings |
| State | Yjs document plus small Zustand stores for UI state | Document state is the CRDT, UI state stays local |
| UI primitives | Radix UI | Accessible panels, menus, popovers, dialogs |
| Styling | CSS modules with our own tokens | The editor should dogfood a token system. No Tailwind in the editor |
| Drag and drop | dnd-kit | Layer tree and canvas insertion |
| Rich text | Tiptap 3 | Canvas text editing and CMS rich fields from one editor with a JSON document model |
| Canvas | Iframe running the renderer package | Style isolation and honest media queries |
| Icons | Lucide | |

## Agent

| Concern | Choice | Why |
| --- | --- | --- |
| Protocol | MCP TypeScript SDK 1.x | Streamable HTTP on the server, stdio through the CLI. Tool inputs are Zod schemas shared with the document API |
| Providers | Anthropic SDK, OpenAI-compatible client, Ollama | Instance owner chooses. Provider abstraction is thin: messages, tools, streaming |
| Screenshots | Playwright Chromium | Also used for OG image rendering and parity tests |
| Visual diff | pixelmatch plus DOM box map | Changed regions plus which nodes moved, no OCR needed because we own the DOM |

## Deliberately not used

- **Next.js or Remix** for anything. The site output is Astro; the editor is a Vite SPA; the server is Hono.
- **Tailwind** as an internal model. Supported as an import format only.
- **Prisma**. Drizzle is lighter and closer to SQL.
- **A hosted database or auth service**. Self-host means self-host.
- **Electron**. The editor is a web app served by the instance.
