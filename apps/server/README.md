# Freeflow server foundation

An authenticated HTTP API for the first Phase 1 milestone. Each account gets a private default
workspace. Sites start from `templates/freeflow`, including its content-addressed assets.
Document operations reuse `@freeflow/document` validation and revision checks.

## Run locally

From the repository root, with Node 22 and pnpm 10:

```sh
pnpm install
pnpm setup:env
pnpm dev
```

The setup script creates a gitignored root `.env` with local defaults, registration enabled and a
random auth secret. It preserves an existing `.env`, including its secret, when rerun. Edit `.env`
to customize the settings; restart the server after changes.

`pnpm run server` is an equivalent command. Use the explicit `run`: `pnpm server` invokes pnpm's
built-in package-store server command instead of this project's script.

Keep the secret stable across restarts. Registration is disabled unless `FREEFLOW_ALLOW_SIGNUP=true`.
Enable it to create your account, then restart with it disabled. The server binds to `127.0.0.1:3000`
by default. Open `http://localhost:3000` for the [visual editor](../editor/README.md), including sign-in
and site creation. `pnpm dev` builds the editor before starting the server.

| Setting | Default | Purpose |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | Required, at least 32 characters | Session signing secret |
| `BETTER_AUTH_URL` | `http://localhost:3000` (uses `PORT`) | Canonical origin for authentication and write requests |
| `FREEFLOW_ALLOW_SIGNUP` | `false` | Explicitly allow account registration |
| `FREEFLOW_DATA_DIR` | Repository `data/` | SQLite database and per-site assets |
| `FREEFLOW_TEMPLATE_DIR` | Repository `templates/freeflow/` | Source template document and assets |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `3000` | Listen port |
| `FREEFLOW_PUBLISH_PORT` | `PORT + 1` | Separate static publishing listener |
| `FREEFLOW_PUBLISH_BASE_URL` | `http://localhost:<publish port>` when auth uses `localhost`; otherwise disabled | Base origin for `<site-id>.<hostname>` published sites |

Relative directory settings resolve from the repository root. Both source and bundled servers
automatically load the root `.env`; exported environment variables take precedence. Without `.env`,
you can supply the settings through the environment. The defaults in the table apply when a setting
is absent; the generated local `.env` explicitly enables registration for account creation.

To run the bundled entry point:

```sh
pnpm build
pnpm --filter @freeflow/server start
```

## Try the milestone

With registration enabled, these commands create an account, sign in and create a site. Use your own
email and password. The cookie jar contains a session credential; keep it private and delete it afterward.

```sh
curl -sS http://localhost:3000/api/auth/sign-up/email \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -d '{"name":"Local owner","email":"owner@example.test","password":"replace-with-your-password"}'

curl -sS -c /tmp/freeflow-cookies http://localhost:3000/api/auth/sign-in/email \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -d '{"email":"owner@example.test","password":"replace-with-your-password"}'

curl -sS -b /tmp/freeflow-cookies http://localhost:3000/api/sites \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -d '{"name":"My first site"}'
```

Copy the returned `id` into `SITE_ID`. A new site starts at revision zero.

```sh
SITE_ID=replace-with-returned-id
curl -sS -b /tmp/freeflow-cookies "http://localhost:3000/api/sites/$SITE_ID/document/apply" \
  -H 'Content-Type: application/json' -H 'Origin: http://localhost:3000' \
  -d '{"expectedRevision":0,"operations":[{"type":"site.update","name":"Saved after restart"}]}'
```

Stop the server and restart it with the same data directory and secret. Then read the document:

```sh
curl -sS -b /tmp/freeflow-cookies "http://localhost:3000/api/sites/$SITE_ID/document"
```

The name is `Saved after restart` and the revision is `1`. The test suite performs this flow over
real HTTP with both source and bundled entry points, terminates the server, starts a new process
and checks the persisted result.

## API

| Method and path | Result |
| --- | --- |
| `GET /health` | Unauthenticated liveness check |
| `POST /api/auth/sign-up/email` | Register when enabled: `{name,email,password}` |
| `POST /api/auth/sign-in/email` | Sign in: `{email,password}`; sets a session cookie |
| `GET /api/auth/get-session` | Current Better Auth session |
| `POST /api/auth/sign-out` | Revoke the session |
| `GET /api/workspaces` | Current user's default workspace |
| `GET /api/sites` | Sites in that workspace |
| `POST /api/sites` | Create a template site: `{name}` |
| `GET /api/sites/:id/document` | `{document,revision}` |
| `GET /api/sites/:id/preview?page=<id>&entry=<id>` | Canvas HTML, warnings and revision; entry required for collection pages |
| `GET /api/sites/:id/assets/:hash` | Authenticated asset bytes belonging to the site |
| `POST /api/sites/:id/document/apply` | `{expectedRevision,operations,dryRun?}` → operation result |
| `GET /api/sites/:id/releases` | Publishing configuration, current release, URL and release history |
| `POST /api/sites/:id/releases` | `{expectedRevision,publishedId}` → `202 {id}`; enqueue an immutable snapshot |
| `POST /api/sites/:id/releases/:releaseId/activate` | `{publishedId}` → switch live output to a successful release; draft unchanged |

Application routes require a session cookie. JSON writes reject cross-origin requests; API responses
disable caching. Unknown or inaccessible sites return `404`, missing sessions `401`, invalid input
`400`, and stale edits `409` with `currentRevision`. Request bodies are limited to 2 MiB and batches
to 1,000 operations. Authentication endpoints use Better Auth's rate limiting and CSRF checks.

## Persistence and scope

`data/freeflow.sqlite` uses WAL mode. SQLite stores auth data, workspaces, site documents and
revisions. Drizzle handles application queries; Better Auth's built-in SQLite adapter owns auth
migrations, run before auth starts. Freeflow's separate migration ledger versions application tables.
Assets live under `data/sites/<id>/assets/`; their hashes are checked when copying the template.

## Publishing

Use **Publish** in the editor header, then **Publish v1** (or the next version). Pending edits are saved before
the dialog opens. Build status and errors appear in release history; successful builds expose an
**Open published site** link. **Restore v1** (or another version) asks for confirmation before switching live output.
Publishing has its own per-site counter: the first release is v1 regardless of the draft revision.
Each accepted publish attempt reserves the next version, including failed builds; rollback retains
the original version. Existing release history is numbered chronologically on upgrade. Document
revisions remain internal snapshot/concurrency metadata and are not shown in the publishing dialog.

Locally, the default published URL is `http://<site-id>.localhost:3001`. Modern browsers resolve
`.localhost` to loopback. The static listener has no editor, authentication or draft API routes.
Production requires an explicit publishing base URL, wildcard DNS and a TLS reverse proxy that
preserves the Host header and routes published hosts to the publishing port. Use a dedicated
publishing domain, separate from the editor and its cookies; never proxy published files through
the editor origin. This milestone does not provision DNS, TLS or external hosting.

Each release stores the exact document and revision in SQLite and copies hash-verified assets into
`data/builds/<site-id>/<release-id>/`. A child process runs the compiler with a five-minute timeout.
Only a successful build atomically updates the SQLite live-release pointer. Failed builds leave
the previous site available; rollback changes this pointer, not the draft. Requests include the
expected current `publishedId` (initially `null`) to prevent stale publish/rollback actions. Only one
release per site can be queued or building. Each server instance runs one build at a time.

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
Yjs sync, git snapshots, staging environments, custom-domain management, shared workspace membership, email verification and
password recovery are later work. The existing CLI/MCP site-folder workflow remains separate.

```sh
pnpm --filter @freeflow/server test
pnpm --filter @freeflow/server typecheck
```
