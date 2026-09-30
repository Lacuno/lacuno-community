# Lacuno Cloud boundary

Lacuno Cloud, at [lacuno.io](https://lacuno.io), is the hosted service. It is developed in a separate
repository and runs this repository's server as its runtime: accounts, workspaces, routing, domains
and operations are Cloud's; the editor, document model, compiler, export, publishing, release
history and rollback are Community's. Community operators remain free to do all of this themselves
using the [self-hosting guide](SELF_HOSTING.md).

Cloud must not copy the editor or write directly into a runtime's database. It talks to a runtime
only through documented interfaces in this repository:

- **Gateway mode** ([GATEWAY_AUTH.md](GATEWAY_AUTH.md)): signed per-request assertions instead of
  local sign-in, roles, user revocation, a site's public origin, the relay for outbound fetches and
  the export sink that copies releases, assets and thumbnails to an edge.
- **Site import**: `POST /api/sites` with a document and its assets, which also moves a site built
  in the browser's try editor into a workspace ([editor README](../apps/editor/README.md#try-build)).
- **Moving out**: a workspace export is a backup in the operator tool's format, imported with
  `backup-cli.js import` ([Moving from Lacuno Cloud](SELF_HOSTING.md#moving-from-lacuno-cloud)).
- **Published listener**: `published-main.js --list` prints the production release of every site.

Owner setup tokens are not Cloud SSO. Do not share session cookies across published sites, weaken
private setup, or use stored owner passwords as the integration boundary.

Community licensing is unchanged by Cloud. See decisions D014 and D015 in
[DECISIONS.md](DECISIONS.md).
