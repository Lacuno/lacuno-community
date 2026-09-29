# Lacuno server foundation

An authenticated HTTP API for the first Phase 1 milestone. Each account gets a private default
workspace. Sites start from `templates/lacuno`, including its content-addressed assets.
Document operations reuse `@lacuno/document` validation and revision checks.

For container deployment and operator-managed infrastructure, see the
[self-hosting guide](../../docs/SELF_HOSTING.md). Managed domain/TLS setup is planned for Cloud,
not the Community server.

## Run locally

From the repository root, with Node 22 and pnpm 10:

```sh
pnpm install
pnpm setup:env
pnpm dev
```

The setup script creates a gitignored root `.env` with local defaults, registration disabled and a
random auth secret. It preserves an existing `.env`, including its secret, when rerun. Edit `.env`
to customize the settings; restart the server after changes.

`pnpm run server` is an equivalent command. Use the explicit `run`: `pnpm server` invokes pnpm's
built-in package-store server command instead of this project's script.

Keep the secret stable across restarts. New private instances use one-time owner setup: start the
server, run `pnpm owner:token` in another terminal, and enter the token in the browser's setup form.
The token is invalidated after account creation; registration stays closed permanently for that
single-owner instance. Existing accounts are preserved. The server binds to `127.0.0.1:3000`
by default. Open `http://localhost:3000` for the [visual editor](../editor/README.md), including sign-in
and site creation. `pnpm dev` builds the editor before starting the server.

| Setting | Default | Purpose |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Required, at least 32 characters | Session signing secret |
| `BETTER_AUTH_URL` | `http://localhost:3000` (uses `PORT`) | Canonical origin for authentication and write requests |
| `LACUNO_ALLOW_SIGNUP` | `false` | Legacy opt-in public registration; cannot reopen a single-owner instance |
| `LACUNO_DATA_DIR` | Repository `data/` | SQLite database and per-site assets |
| `LACUNO_TEMPLATE_DIR` | Repository `templates/lacuno/` | Source template document and assets |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `3000` | Listen port |
| `LACUNO_PUBLISH_PORT` | `PORT + 1` | Separate static publishing listener |
| `LACUNO_PUBLISH_BASE_URL` | `http://localhost:<publish port>` when auth uses `localhost`; otherwise disabled | Base origin for `<site-id>.<hostname>` published sites, or a template with `{site}` in the hostname |

Relative directory settings resolve from the repository root. Both source and bundled servers
automatically load the root `.env`; exported environment variables take precedence. Without `.env`,
you can supply the settings through the environment. The defaults in the table apply when a setting
is absent. Existing `.env` files are preserved, including older registration settings.

To run the bundled entry point:

```sh
pnpm build
pnpm --filter @lacuno/server start
```

## Try the milestone

For an explicitly configured legacy multi-account instance with registration enabled, these commands
create an account, sign in and create a site. Default Community installations use the owner setup
screen instead (then the sign-in and site-creation commands below work normally). Use your own
email and password. The cookie jar contains a session credential; keep it private and delete it afterward.

```sh
curl -sS http://localhost:3000/api/auth/sign-up/email \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -d '{"name":"Local owner","email":"owner@example.test","password":"replace-with-your-password"}'

curl -sS -c /tmp/lacuno-cookies http://localhost:3000/api/auth/sign-in/email \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -d '{"email":"owner@example.test","password":"replace-with-your-password"}'

curl -sS -b /tmp/lacuno-cookies http://localhost:3000/api/sites \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -d '{"name":"My first site"}'
```

Copy the returned `id` into `SITE_ID`. A new site starts at revision zero.

```sh
SITE_ID=replace-with-returned-id
curl -sS -b /tmp/lacuno-cookies "http://localhost:3000/api/sites/$SITE_ID/document/apply" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -d '{"expectedRevision":0,"operations":[{"type":"site.update","name":"Saved after restart"}]}'
```

Stop the server and restart it with the same data directory and secret. Then read the document:

```sh
curl -sS -b /tmp/lacuno-cookies "http://localhost:3000/api/sites/$SITE_ID/document"
```

The name is `Saved after restart` and the revision is `1`. The test suite performs this flow over
real HTTP with both source and bundled entry points, terminates the server, starts a new process
and checks the persisted result.

## API

| Method and path | Result |
| --- | --- |
| `GET /health` | Unauthenticated liveness check |
| `GET /api/config` | Public registration availability and `setupRequired`; never includes the token |
| `POST /api/setup` | One-time owner creation: `{name,email,password,token}`; requires the exact editor Origin |
| `POST /api/auth/sign-up/email` | Register when enabled: `{name,email,password}` |
| `POST /api/auth/sign-in/email` | Sign in: `{email,password}`; sets a session cookie |
| `GET /api/auth/get-session` | Current Better Auth session |
| `POST /api/auth/sign-out` | Revoke the session |
| `GET /api/workspaces` | Current user's default workspace |
| `GET /api/sites` | Sites in that workspace |
| `POST /api/sites` | Create a template site: `{name}` |
| `GET /api/sites/:id/document` | `{document,revision}` |
| `GET /api/sites/:id/preview?page=<id>&entry=<id>` | Canvas HTML, warnings and revision; entry required for collection pages |
| `POST /api/sites/:id/assets/upload` | `{name,data}` (base64, up to 10 MB) → staged asset reference; PNG, JPEG, WebP, GIF, MP4, WebM, WOFF2, WOFF, TTF or OTF, typed by its bytes |
| `GET /api/sites/:id/assets/:hash` | Authenticated asset bytes belonging to the site |
| `POST /api/sites/:id/document/apply` | `{expectedRevision,operations,dryRun?}`, or `{expectedRevision,patches}` to replay an earlier commit → operation result |
| `GET /api/sites/:id/releases` | `enabled`, `publishedId` and `url` (production), `testingId` and `testingUrl`, and release history; `{enabled:false,releases:[]}` when publishing is not configured |
| `POST /api/sites/:id/releases` | `{expectedRevision,expectedId,name?,target?}` → `202 {id,target}`; enqueue an immutable snapshot that goes live on `target` (`production` by default) when it is built |
| `POST /api/sites/:id/releases/:releaseId/activate` | `{expectedId,target?}` → `{id,target}`; point `target` (`production` by default) at a successful release without a build: rollback, promote or send to testing; draft unchanged |
| `POST /api/sites/:id/releases/:releaseId/name` | `{name}` → rename a release; an empty name clears it |
| `GET /api/sites/:id/events` | Server-sent events, one `batch` per committed apply: `{revision,patches,actor,at,summary}`; `?since=<revision>` or `Last-Event-ID` replays what was missed |
| `GET /api/sites/:id/connections` | AI apps approved for the site: `[{id,app,approvedAt,lastActiveAt,active}]` |
| `DELETE /api/sites/:id/connections/:id` | Revoke an app's tokens and close its sessions → `204` |
| `POST/GET/DELETE /mcp/:id` | MCP over Streamable HTTP for one site; bearer token from the server's own OAuth, else `401` with `WWW-Authenticate … resource_metadata` |
| `GET /.well-known/oauth-authorization-server`, `GET /.well-known/oauth-protected-resource/mcp/:id` | OAuth discovery for MCP clients; authorization, token, registration and revocation live under `/api/auth/oauth2/*`; consent is the editor's `/consent` page |

Application routes require a session cookie; `/mcp/:id` takes an OAuth bearer token instead
(opaque, one hour, refreshable, bound to one site through its audience and revoked with the
connection). Dynamic client registration and Client ID Metadata Documents are both accepted, loopback
redirect URIs match without regard to port, and `iss` is returned in the authorization response. JSON writes reject cross-origin requests; API responses
disable caching. Unknown or inaccessible sites return `404`, missing sessions `401`, invalid input
`400`, and stale edits `409` with `currentRevision`. Request bodies are limited to 2 MiB and batches
to 1,000 operations or 5,000 patches. Authentication endpoints use Better Auth's rate limiting and CSRF checks.
The setup endpoint additionally requires a 256-bit server-side token. SQLite enforces one owner
even across simultaneous setup requests. Owner passwords and sessions still use Better Auth.

## Persistence and scope

`data/lacuno.sqlite` uses WAL mode. SQLite stores auth data, workspaces, site documents and
revisions. Drizzle handles application queries; Better Auth's built-in SQLite adapter owns auth
migrations, run before auth starts. Lacuno's separate migration ledger versions application tables.
Assets live under `data/sites/<id>/assets/`; their hashes are checked when copying the template.

## Publishing

Use **Publish** in the editor header, then **Publish v1** (or the next version). Pending edits are saved before
the dialog opens. Build status and errors appear in release history; successful builds expose an
**Open published site** link. **Restore v1** (or another version) asks for confirmation before switching live output.
Publishing has its own per-site counter: the first release is v1 regardless of the draft revision.
Each accepted publish attempt reserves the next version, including failed builds; rollback retains
the original version. Existing release history is numbered chronologically on upgrade. Document
revisions remain internal snapshot/concurrency metadata and are not shown in the publishing dialog.
An optional **Release name** (at most 80 characters) is shown after the version, as in `v7 · Spring
launch`, and can be changed later with **Rename v7**. The dialog lists the live, testing and newest
release; older ones sit in a closed **Earlier releases** section with their restore buttons.

**Publish v8 to testing** builds the draft for the testing address,
`http://<site-id>-testing.localhost:3001` locally, which sends `X-Robots-Tag: noindex, nofollow` on
every response. The testing release carries a **Testing** badge next to the **Live** one and offers
**Promote v8 to production**, which makes the same build live without rebuilding it. Any successful
release offers **Send v7 to testing** to point testing at it; **Restore v7** stays the production
rollback and leaves testing alone. Releases are not tied to a target; each records the target it was published
for. Built pages link to the production URL, so a promoted build needs no rebuild.

Locally, the default published URL is `http://<site-id>.localhost:3001`. A **Public URL** set in Site settings replaces it in canonical links, social URLs, the sitemap and robots.txt; behind a gateway, the site's origin the gateway sets (`POST /api/gateway/site-origin`, [GATEWAY_AUTH.md](../../docs/GATEWAY_AUTH.md)) replaces it unless Site settings has one. Modern browsers resolve
`.localhost` to loopback. The static listener has no editor, authentication or draft API routes.
Production requires an explicit publishing base URL, wildcard DNS and a TLS reverse proxy that
preserves the Host header and routes published hosts to the publishing port. Use a dedicated
publishing domain, separate from the editor and its cookies; never proxy published files through
the editor origin. This milestone does not provision DNS, TLS or external hosting.

Each release stores the exact document and revision in SQLite and copies hash-verified assets into
`data/builds/<site-id>/<release-id>/`. A child process runs the compiler with a five-minute timeout.
Optimized images carry over between a site's builds in `data/builds/<site-id>/images/`, keyed by
source hash and transform, so a publish re-encodes only new or changed images. A successful build
leaves exactly the images it output there; backups leave the cache out, since any build refills it.
Publishing a document that already has a successful release, such as the draft just sent to testing,
copies that release's output instead of building again.
Only a successful build atomically updates the SQLite live-release pointer. Failed builds leave
the previous site available; rollback changes this pointer, not the draft. Requests include the
expected current pointer for their target as `expectedId` (initially `null`) to prevent stale
publish/rollback actions. Only one release per site can be queued or building. Each server instance
runs one build at a time.

Queued jobs resume after restart. Graceful shutdown marks its active build failed; after a crash,
the queue marks it failed once its 30-second worker lease has expired so it can be retried. Multiple
instances must share both SQLite and the build/asset filesystem. Release history, outputs and failed
build directories are retained; automatic retention and disk quotas are not implemented yet. Back
up the database and filesystem together. Hashed assets from older successful releases remain
available so visitors loading old HTML can finish loading after a release switch.

The document and revision update in one conditional SQL statement. Concurrent writers cannot commit
the same base revision, including across server instances. Invalid batches and dry runs leave the
stored document untouched. Failed site creation removes its partially copied assets; a process crash
during creation can leave an unreferenced asset directory.

The database is authoritative for server sites; these directories are not CLI site folders yet.
Yjs sync, git snapshots, custom-domain management, shared workspace membership, email verification and
password recovery are later work. The existing CLI/MCP site-folder workflow remains separate.

```sh
pnpm --filter @lacuno/server test
pnpm --filter @lacuno/server typecheck
```
