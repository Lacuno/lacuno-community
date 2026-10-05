# Technology stack

Pinned September 2026. Every choice has a reason and a fallback. Upgrade deliberately, one thing at
a time, with the test suite green. Rows marked planned name the intended choice for work that is not
built yet.

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
| Package builds | tsdown | Rolldown-based, fast, produces ESM plus types. Only the CLI and server are bundled; workspace packages are inlined into those bundles and consumed from source everywhere else. Astro, sharp and other runtime engines stay external dependencies of the bundle | tsup |

## Core packages

| Concern | Choice | Why |
| --- | --- | --- |
| Schema | Zod 4 | Runtime validation, inferred types, JSON Schema export for MCP tool inputs. The document schema is the contract for every other package |
| Live document | Plain JSON with named operations (D026) | Validation, dry runs and version pinning for editor and agents alike. Yjs is not used (D006) |
| CSS generation | Our own, no dependency | Deterministic output is the whole point. Astro minifies the result at build time |
| Site output | Astro 7 | Static by default, islands when needed, content collections, image service, view transitions. The best static generator for content sites and it keeps improving |
| Image processing | sharp, through Astro | Responsive sizes, AVIF and WebP |

## Server

| Concern | Choice | Why |
| --- | --- | --- |
| HTTP | Hono 4 | Small, fast, typed routes, runs on Node today and on other runtimes if we ever want that |
| Database | SQLite via better-sqlite3, WAL mode | Zero-service self-hosting. Postgres via the same Drizzle schema is planned for deployments that need it |
| ORM and migrations | Drizzle | Typed SQL, plain migration files, SQLite and Postgres from one schema |
| Auth | better-auth, with its OAuth provider plugin | Email and password and sessions, all self-hosted; the same server issues the OAuth tokens AI apps use. Magic links and OIDC are planned |
| Gateway assertions | jose | Verifies the signed per-request assertions of [gateway mode](GATEWAY_AUTH.md) |
| Realtime | Server-sent events | Committed batches reach every open editor. A WebSocket for presence and collaboration is planned |
| Git | Planned: the git binary in the container | Sites as repositories (D005) are not built yet |
| Build queue | Child process per build | The compiler changes the working directory for Astro, so builds cannot share a process. A separate build worker service is a config option later |
| Email | Nodemailer with SMTP | Form messages to the site owner; magic links are planned |
| TLS and domains | Operator's reverse proxy (for example Caddy or nginx) | Community documents manual setup; managed provisioning is future Cloud scope |
| Container | `node:22-bookworm-slim`, non-root, one volume | Editor on port 3000, published sites on 3001, data in `/data`; see [self-hosting](SELF_HOSTING.md) |

## Editor

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | React 19 with Vite | The editor tooling ecosystem lives here, Tiptap included |
| State | A session module over the document plus React state | The server is the source of truth; the session holds the snapshot, pending edits and undo history |
| UI primitives | Native elements: `dialog`, the Popover API, `details` | No component library to keep up with |
| Styling | Plain CSS files | No Tailwind in the editor |
| Drag and drop | Pointer events | Canvas and layer drags need hit-testing of our own (D025) |
| Rich text | Tiptap 3 | Canvas text editing and CMS rich fields from one editor with a JSON document model |
| Canvas | Iframe with the renderer's HTML, morphed by idiomorph | Style isolation, honest media queries, no reloads (D028) |
| Icons | Inline SVG | Published sites inline a curated set of Lucide icons (ISC) |

## Agent

| Concern | Choice | Why |
| --- | --- | --- |
| Protocol | MCP TypeScript SDK 1.x | Streamable HTTP on the server, stdio through the CLI. Tool inputs are Zod schemas shared with the document API |
| Providers | None | Lacuno never calls a model; the user's own AI app connects over MCP (D016) |
| Screenshots | Playwright Chromium, an optional dependency | `page.screenshot` and the browser tests |
| Diff | Our own document diff | `document.diff` summarises changes by page, node, style and token; no pixel diff |

## Deliberately not used

- **Next.js or Remix** for anything. The site output is Astro; the editor is a Vite SPA; the server is Hono.
- **Tailwind** as an internal model. Supported as an import format only.
- **Prisma**. Drizzle is lighter and closer to SQL.
- **A hosted database or auth service**. Self-host means self-host.
- **Electron**. The editor is a web app served by the instance.
