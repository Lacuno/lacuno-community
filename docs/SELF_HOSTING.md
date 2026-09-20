# Self-hosting Freeflow Community

Community includes the builder, compiler, publishing and rollback. You operate the infrastructure:
server provisioning, DNS, HTTPS, access control, backups, monitoring and updates. Freeflow Cloud is
a planned paid managed service, not a requirement for using Community. This guide does not provision
hosting or manage domains and certificates for you.

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
the same secret across restarts and updates. Leave `FREEFLOW_ALLOW_SIGNUP=false`.

```sh
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --tail=100 freeflow
```

Open `http://localhost:3000`. On a fresh private instance, the first-run screen asks you to create
the owner account. Retrieve its one-time setup token from your server terminal:

```sh
docker compose --env-file .env.docker exec freeflow node apps/server/dist/setup-token.js
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
`FREEFLOW_ALLOW_SIGNUP=true` option remains for explicitly configured multi-account instances, not
for the default Community setup. Keep it disabled on an existing instance to stop public signup.

The container runs as UID/GID 1000, with production dependencies, no compiler toolchain, and a
health check on `/health`. Both host ports bind to loopback by default. SQLite, assets, snapshots
and compiled releases are stored in the `freeflow-data` named volume at `/data`. Container
recreation preserves this volume. **Do not run `docker compose down -v`: it deletes the data volume.**
Keep the Compose project name stable; changing the directory/project name selects a different volume.
If using a bind mount instead, its directory must be writable by UID/GID 1000.

## Public deployment: operator-managed

Deploy on a server you control. Build the image there, or transport an image built for that server's
CPU architecture. There is no official prebuilt image or automated update service yet.

Use a dedicated publishing domain distinct from the editor's domain. For example, configure:

```dotenv
BETTER_AUTH_URL=https://editor.example.com
FREEFLOW_PUBLISH_BASE_URL=https://sites.example.net
FREEFLOW_ALLOW_SIGNUP=false
```

Configure DNS yourself: the editor hostname and `*.sites.example.net` must point to your server.
Obtain and renew certificates using your chosen reverse proxy and certificate tooling. Wildcard
certificates typically require DNS validation; configure that separately with your DNS provider.
Expose HTTPS through that proxy, leaving application ports private:

| Public host | Upstream on the Docker host | Requirements |
| --- | --- | --- |
| `editor.example.com` | `http://127.0.0.1:3000` | HTTPS; forward the original Host and request scheme |
| `*.sites.example.net` | `http://127.0.0.1:3001` | HTTPS; preserve Host so the server identifies the site UUID |

For a proxy in another container, connect it to the Compose network and use `freeflow:3000` and
`freeflow:3001` instead of loopback. Only expose the proxy's HTTP/HTTPS ports publicly. Configure
body-size/time limits to accommodate uploads (the API allows 15 MiB on its image-upload endpoint).

Published pages may contain user-authored scripts. Never serve them on the editor's origin, route
published hosts to the editor listener, or share authentication cookies with the publishing domain.
The static listener has no auth or draft API. Its routing currently supports UUID subdomains of one
configured publishing base, not arbitrary per-site custom-domain mappings. Managed domain connection,
certificate provisioning and deployment orchestration belong to the planned Cloud service.

Recreate the container after changing settings, then check editor sign-in, publishing, a public
page, its assets and rollback through HTTPS. The Docker health check checks API liveness only, not
your DNS, certificates or individual published sites. Monitor those yourself. Run one instance per
data volume; multi-host SQLite/shared-filesystem deployments are outside this guide.

## Backup and restore

Back up the entire `/data` volume and securely retain `.env.docker`, including the auth secret.
The SQLite database alone is insufficient: releases and uploaded asset bytes live alongside it.
Backups contain private documents and authentication data. Encrypt them and keep off-server copies.

For a consistent offline backup, stop the application first. This interrupts active builds (they
are marked failed and can be published again). Choose a new backup filename each time:

```sh
umask 077
docker compose --env-file .env.docker stop freeflow
docker compose --env-file .env.docker run --rm --no-deps -T --entrypoint tar freeflow \
  -czf - -C /data . > freeflow-backup.tar.gz
docker compose --env-file .env.docker start freeflow
tar -tzf freeflow-backup.tar.gz
```

Check that the backup command succeeded before relying on the archive. Store the image/repository
commit used for that backup. Regularly test restoration, not just archive creation.

Restore into a **new, empty volume**, not on top of a running or existing database. For example, a
new Compose project creates a separate volume (the original instance must be stopped to free the
ports). Use the image matching the backup and the original auth secret:

```sh
docker compose --env-file .env.docker -p freeflow-restore run --rm --no-deps -T \
  --entrypoint tar freeflow -xzf - --no-same-owner -C /data < freeflow-backup.tar.gz
docker compose --env-file .env.docker -p freeflow-restore up -d
```

Verify login, draft content, asset previews, live pages and release history before switching traffic.
Retain the original volume until recovery is confirmed. Do not import archives from untrusted sources.

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

For development verification, `docker build -t freeflow-community:local .` followed by
`pnpm smoke:docker` tests a disposable container and volume: non-root execution, account creation,
editing, publishing, restart persistence and offline backup/restore into a fresh volume. It deletes
only its own temporary container and volumes.

References: [Docker Compose](https://docs.docker.com/compose/),
[Docker volumes](https://docs.docker.com/engine/storage/volumes/),
[Node container recommendations](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md).
