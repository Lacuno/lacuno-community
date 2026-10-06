# Self-hosting Lacuno Community

Community includes the builder, compiler, publishing and rollback. You operate the infrastructure:
server provisioning, DNS, HTTPS, access control, backups, monitoring and updates. Lacuno Cloud, the
hosted service at [lacuno.io](https://lacuno.io), does that for you; it is not a requirement for
using Community. This guide does not provision hosting or manage domains and certificates for you.

Use trusted accounts, keep independent backups, and test upgrades before deploying them.
Email verification, password recovery, storage quotas and
automatic release retention are not implemented. Registration should normally remain disabled.

## Local container setup

Install Docker Engine with Compose v2 (or Docker Desktop), and clone this repository. Run from its
root. No host Node.js installation is needed; the image builds the application from source.

```sh
cp .env.docker.example .env.docker
openssl rand -hex 32
```

Put the generated value in `BETTER_AUTH_SECRET` in `.env.docker`. Keep this file private and keep
the same secret across restarts and updates. Leave `LACUNO_ALLOW_SIGNUP=false`.

```sh
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --tail=100 lacuno
```

Open `http://localhost:3000`. On a fresh private instance, the first-run screen asks you to create
the owner account. Retrieve its one-time setup token from your server terminal:

```sh
docker compose --env-file .env.docker exec lacuno node apps/server/dist/setup-token.js
```

Paste the token into the setup form with your name, email and password. Treat the token as a secret:
anyone with it can claim the unconfigured instance. It is not exposed by the API or printed in server
logs, survives restarts before setup, and is invalidated when the owner account is created.
Registration remains closed automatically, including after restarts. New private instances permit
one owner account; an environment-variable change cannot reopen registration on that instance.

Create a site, then publish v1. The published URL is
`http://<site-id>.localhost:3001`. Modern browsers resolve `.localhost` to loopback; this local URL
is not reachable by visitors on other machines. Existing installations retain their accounts and
registration configuration; owner setup does not remove or convert existing users. The legacy
`LACUNO_ALLOW_SIGNUP=true` option remains for explicitly configured multi-account instances, not
for the default Community setup. Keep it disabled on an existing instance to stop public signup.

The container runs as UID/GID 1000, with production dependencies, no compiler toolchain, and a
health check on `/health`. Both host ports bind to loopback by default. SQLite, assets, snapshots
and compiled releases are stored in the `lacuno-data` named volume at `/data`. Container
recreation preserves this volume. **Do not run `docker compose down -v`: it deletes the data volume.**
Keep the Compose project name stable; changing the directory/project name selects a different volume.
If using a bind mount instead, its directory must be writable by UID/GID 1000.

## Public deployment: operator-managed

Deploy on a server you control. Build the image there, or use the prebuilt one:
`ghcr.io/lacuno/lacuno-community:main` is built from `main` on every push, for linux/amd64, and each
build is also tagged with its commit (`:<commit sha>`). Pin a tag or a digest rather than following
`:main` blindly, and test an update before you roll it out. To use it, replace `build: .` and the
`image:` line of the `lacuno` service in `compose.yaml` with `image:
ghcr.io/lacuno/lacuno-community:<tag>` and start without `--build`. There is no automated update
service.

Use a dedicated publishing domain distinct from the editor's domain. For example, configure:

```dotenv
BETTER_AUTH_URL=https://editor.example.com
LACUNO_PUBLISH_BASE_URL=https://sites.example.net
LACUNO_ALLOW_SIGNUP=false
```

Configure DNS yourself: the editor hostname and `*.sites.example.net` must point to your server.
Obtain and renew certificates using your chosen reverse proxy and certificate tooling. Wildcard
certificates typically require DNS validation; configure that separately with your DNS provider.
Expose HTTPS through that proxy, leaving application ports private:

| Public host | Upstream on the Docker host | Requirements |
| --- | --- | --- |
| `editor.example.com` | `http://127.0.0.1:3000` | HTTPS; forward the original Host and request scheme |
| `*.sites.example.net` | `http://127.0.0.1:3001` | HTTPS; preserve Host so the server identifies the site UUID |

The same wildcard covers testing: `<site-id>-testing.sites.example.net` serves a site's testing
publication, so no extra DNS record or certificate is needed. Every testing response carries
`X-Robots-Tag: noindex, nofollow`; testing has no password or private link, so anyone with the
address can open it.

To put the site in one label instead, write `{site}` where it goes:
`LACUNO_PUBLISH_BASE_URL=https://{site}--main.sites.example.net` serves
`<site-id>--main.sites.example.net` and `<site-id>-testing--main.sites.example.net`. One wildcard
certificate for `*.sites.example.net` then covers every site, whatever else shares that domain.

For a proxy in another container, connect it to the Compose network and use `lacuno:3000` and
`lacuno:3001` instead of loopback. Only expose the proxy's HTTP/HTTPS ports publicly. Configure
body-size/time limits to accommodate uploads (the API allows 15 MiB on its image-upload endpoint).

Published pages may contain user-authored scripts. Never serve them on the editor's origin, route
published hosts to the editor listener, or share authentication cookies with the publishing domain.
The static listener has no auth or draft API. Its routing currently supports UUID subdomains of one
configured publishing base, not arbitrary per-site custom-domain mappings. Managed domain connection,
certificate provisioning and deployment orchestration belong to Lacuno Cloud.

Published forms mail each message to the workspace owner and store nothing. To turn them on, set an
SMTP server and a sender in `.env.docker` (both, or neither; without them the editor says forms are
off and a form answers that the message couldn't be sent):

```dotenv
LACUNO_SMTP_URL=smtps://user:password@smtp.example.com:465
LACUNO_MAIL_FROM=Lacuno <forms@example.com>
```

The sender's domain needs the SPF and DKIM records your mail provider asks for, or messages land in
spam. Forms limit each visitor to five messages a site in ten minutes, by the last address in
`X-Forwarded-For`: make your proxy append the client's address (Caddy's `reverse_proxy` does by
default; nginx with `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`), or every
visitor shares the proxy's.

Recreate the container after changing settings, then check editor sign-in, publishing, a public
page, its assets and rollback through HTTPS. The Docker health check checks API liveness only, not
your DNS, certificates or individual published sites. Monitor those yourself. Run one instance per
data volume; multi-host SQLite/shared-filesystem deployments are outside this guide.

## Screenshots for AI apps

The runtime image has no browser, so connected AI apps are offered `page.screenshot` only when a
screenshot service is configured. Its image, `ghcr.io/lacuno/lacuno-screenshots`, is built and
tagged with the server image (or locally with `docker build --target screenshots .`): one headless
Chromium, a fresh browser context per screenshot and nothing written to disk. Add it to
`compose.yaml` beside `lacuno`, without published ports:

```yaml
  screenshots:
    image: ghcr.io/lacuno/lacuno-screenshots:<tag>
    init: true
    restart: unless-stopped
    mem_limit: 1.5g
    environment:
      LACUNO_SCREENSHOT_SECRET: ${LACUNO_SCREENSHOT_SECRET:-}
```

and give the `lacuno` service `LACUNO_SCREENSHOT_URL: http://screenshots:3000` and the same
`LACUNO_SCREENSHOT_SECRET`. The service renders `LACUNO_SCREENSHOT_SLOTS` pages at once (default 2);
others wait up to 20 seconds, after which the AI app is told to try again. Each slot can take a few
hundred MB on a long page, so size the memory limit with the slots. Pages only reach their own
assets: web fonts and images from other sites do not appear in screenshots.

## Backup and restore

Back up the entire `/data` volume and securely retain `.env.docker`, including the auth secret.
The SQLite database alone is insufficient: releases and uploaded asset bytes live alongside it.
Backups contain private documents and authentication data. Encrypt them and keep off-server copies.

For a consistent offline backup, stop the application first. This interrupts active builds (they
are marked failed and can be published again). Choose a new backup filename each time:

```sh
umask 077
docker compose --env-file .env.docker stop lacuno
docker compose --env-file .env.docker run --rm --no-deps -T --entrypoint tar lacuno \
  -czf - -C /data . > lacuno-backup.tar.gz
docker compose --env-file .env.docker start lacuno
tar -tzf lacuno-backup.tar.gz
```

Check that the backup command succeeded before relying on the archive. Store the image/repository
commit used for that backup. Regularly test restoration, not just archive creation.

Restore into a **new, empty volume**, not on top of a running or existing database. For example, a
new Compose project creates a separate volume (the original instance must be stopped to free the
ports). Use the image matching the backup and the original auth secret:

```sh
docker compose --env-file .env.docker -p lacuno-restore run --rm --no-deps -T \
  --entrypoint tar lacuno -xzf - --no-same-owner -C /data < lacuno-backup.tar.gz
docker compose --env-file .env.docker -p lacuno-restore up -d
```

Verify login, draft content, asset previews, live pages and release history before switching traffic.
Retain the original volume until recovery is confirmed. Do not import archives from untrusted sources.

### Online backups with the operator tool

The server's operator tool, `apps/server/dist/backup-cli.js` in the image and in a built checkout,
can snapshot a running instance without stopping the editor or the published-site listener:

```sh
node apps/server/dist/backup-cli.js backup /absolute/live-data /absolute/new-backup
node apps/server/dist/backup-cli.js verify /absolute/new-backup
node apps/server/dist/backup-cli.js restore /absolute/new-backup /absolute/empty-restored-data
node apps/server/dist/backup-cli.js import /absolute/lacuno-export.zip /absolute/empty-data
```

The SQLite online snapshot contains drafts, accounts, release history and publication pointers.
The tool copies referenced immutable assets and every ready release's published output, then writes
a checksummed completion manifest. Unfinished builds become failed in the restored snapshot and can
be published again. Temporary build files and unreferenced uploads are not included. This relies on
the current no-pruning policy for immutable assets and releases. A missing file or bad checksum
fails the backup rather than producing a partial success.

Restore verifies the complete inventory and SQLite integrity and only writes to an empty directory.
It does not replace or restart a live instance. Use the same server version and keep the original
environment and secrets separately; gateway instances also require the same issuer and audience.
Backups contain sensitive account and site data, are not encrypted, and are not a substitute for
off-host storage. Treat only operator-owned backups as trusted: checksums detect corruption, not
forgery. `import` reads a workspace exported from Lacuno Cloud (below) with the same checks.

## Moving from Lacuno Cloud

In Lacuno Cloud, open the workspace's menu → **Export** → **Export workspace**. You get an email
when the export is ready and download it from the same page, as the workspace's owner, for 24 hours.
It is a zip with a `README.txt` and, under `backup/`, a backup in the format above: the database with
every site, page, style, CMS collection and entry and the release history, the uploaded files, the
files of each site's live and testing release, and `backup.json` with each file's size and SHA-256.

What stays behind: Cloud accounts and sessions (you create a new owner), AI app connections
(connect your apps again), custom domains (point them at your server), and the files of older
releases, which show as failed in the release history and cannot be rolled back to.

1. Set up Community as in [Local container setup](#local-container-setup), but do not start it and
   do not create an owner: `.env.docker` with its secret, nothing else.
2. Put the zip in the repository directory and import it into the instance's new, empty volume:

   ```sh
   docker compose --env-file .env.docker build
   docker compose --env-file .env.docker run --rm --no-deps -T \
     -v "$PWD/lacuno-export.zip:/import/export.zip:ro" \
     --entrypoint node lacuno apps/server/dist/backup-cli.js import /import/export.zip /data
   ```

   It checks every file against its checksum and the database's integrity, copies the backup into
   `/data` and removes what belonged to Cloud. It refuses a volume that is not empty and a damaged
   or altered zip, and changes nothing then. The zip is unpacked in the container's `/tmp` first,
   so the import needs free disk space of about twice the zip's size.
3. Start Lacuno, get a setup token and create the owner account at `http://localhost:3000`:

   ```sh
   docker compose --env-file .env.docker up -d
   docker compose --env-file .env.docker exec lacuno node apps/server/dist/setup-token.js
   ```

   The owner gets the imported workspace with all its sites. Their live and testing releases are
   served as they were, at the addresses of [Public deployment](#public-deployment-operator-managed);
   publishing again builds the same site on your server.
4. Point your own domains at your server, reconnect your AI apps, and delete the workspace in
   Lacuno Cloud when you no longer need it.

Without Docker, build the server (`pnpm install && pnpm --filter @lacuno/editor build && pnpm
--filter @lacuno/server build`) and run
`node apps/server/dist/backup-cli.js import lacuno-export.zip data` into an empty `data` directory
before the first start.

A published site alone needs no Lacuno at all: the Export page's **Download live** (or **Download
testing**) gives its files as a zip for any web server or static host. Serve them from the root of a
domain or subdomain, with a folder's `index.html` as its page: pages link to each other and to
`/assets/` and `/_astro/` from the root, so they do not work from a subdirectory or opened straight
from disk. The zip has the files every release of the site shared, so it may hold a few that only
earlier releases used.

## Updates and troubleshooting

Back up first. Check out the intended release/commit, review migration notes, then run
`docker compose --env-file .env.docker build --pull` and
`docker compose --env-file .env.docker up -d`. Database migrations run at startup. Returning to an
older application image may require restoring its matching database backup; published-site rollback
does not roll back application/database versions.

- **Missing secret:** generate and set `BETTER_AUTH_SECRET`; it must contain at least 32 characters.
- **Setup token:** start the server before running the token command. After setup it reports that
  no setup is pending. It is not an account-recovery mechanism; do not delete users from SQLite to
  reopen setup. Existing accounts should sign in normally.
- **Sign-in/write failures:** check the exact public `BETTER_AUTH_URL`, HTTPS and proxy routing.
- **Published 404:** check the live release, UUID hostname and preserved Host header on port 3001.
- **Permission errors:** check volume ownership, especially with host bind mounts.
- **Failed builds:** inspect release history and `docker compose ... logs`. Check free disk space and
  available memory. Failed builds leave the previous live release intact.
- **Disk growth:** all releases and failed build directories are retained. Monitor storage; do not
  manually delete live release files or asset bytes. Automated retention is not yet available.

For development verification, `docker build -t lacuno-community:local .` followed by
`pnpm smoke:docker` tests a disposable container and volume: non-root execution, account creation,
editing, publishing, restart persistence and offline backup/restore into a fresh volume. It deletes
only its own temporary container and volumes.

References: [Docker Compose](https://docs.docker.com/compose/),
[Docker volumes](https://docs.docker.com/engine/storage/volumes/),
[Node container recommendations](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md).
