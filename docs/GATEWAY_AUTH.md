# Authenticated gateway mode

Ordinary self-hosting uses local-owner setup and needs none of this configuration. Gateway mode is an
explicit integration for operators whose trusted reverse proxy authenticates users and authorizes
every request. It does not add managed domains, billing or a hosted control plane to Community.

Set both `LACUNO_GATEWAY_ISSUER` (the gateway's exact origin) and `LACUNO_GATEWAY_SECRET` (at least
32 characters of independently generated secret material), with `BETTER_AUTH_URL` set to the exact
public editor origin. Keep the runtime private behind the proxy and use HTTPS outside local development.
The gateway and runtime must agree on that origin as the assertion audience.

Initialization requires an instance without local accounts. It creates a passwordless managed owner;
all gateway-authorized users act with that owner's access. It disables local signup, owner setup and
local auth endpoints except the verified session-profile endpoint. Gateway mode, issuer and audience
are persisted: removing configuration or changing identity cannot reopen local setup. Existing owner
instances require a separately designed migration; no automatic conversion or data deletion occurs.

## Request protocol (version 1)

For every request, the proxy strips browser cookies and any supplied `X-Lacuno-Assertion`, then
sets that header to an HS256 JWT signed using the UTF-8 gateway secret. Required claims:

| Claim | Value |
| --- | --- |
| `iss`, `aud` | Configured gateway issuer and exact public editor origin |
| `sub`, `name`, `email` | Authenticated user identifier, display name and email |
| `iat`, `exp` | Integer Unix seconds; lifetime at most 30 seconds, no future issue time |
| `jti` | Fresh UUID per request; persisted in SQLite until expiry to prevent replay |
| `method` | Exact HTTP method |
| `target` | Exact URL pathname plus query string |
| `bodyHash` | Lowercase SHA-256 hex of the exact request-body bytes, including the empty body |
| `system` | Optional; `true` only on the gateway's own revocation requests (below) |
| `role` | Optional; `owner`, `editor` or `viewer`, the user's role in the workspace. Absent means `owner` |

Do not send assertions to the browser or place them in URLs. Re-sign retries with a new nonce.
`GET /health` and `/api/config` are public readiness/configuration endpoints; editor HTML, assets and
management APIs require assertions. `/api/config` reports `authentication: "gateway"` and
`gatewayProtocol: 1`. `GET /api/auth/get-session` returns the verified identity profile, not a local
browser session. The gateway owns browser logout and immediate session/membership revocation; AI
connections outlive both until revoked (below).

**Roles.** The runtime refuses what the asserted role does not allow, with 403: a `viewer` only
reads (`GET` and `HEAD`) and cannot open the consent flow, an `editor` cannot publish, rename or
roll back releases (`POST /api/sites/<id>/releases…`). The editor hides Publish from all but the
owner and Connect from viewers, and opens read-only for a viewer. The runtime keeps each user's
last asserted role, because MCP requests carry a token and no assertion: `site.publish` is
offered only in sessions whose approving user was last asserted as `owner`. A gateway that lowers
a role revokes the user (below), which also forgets the role, and asserts the new one next.

## Connect your AI

AI apps connect to one site at `<editor origin>/mcp/<site>` with OAuth issued by the runtime, whose
issuer is `<editor origin>/api/auth`. The protocol stays version 1: these are added routes, and an
older runtime answers them with 401 or 404.

**Anonymous routes.** They authenticate themselves, so the gateway forwards them without a user and
the runtime ignores any assertion on them. Forward only `content-type`, `accept`, `authorization`,
`mcp-session-id`, `mcp-protocol-version`, `last-event-id` and `x-lacuno-client-ip`, and pass back
only `content-type`, `cache-control`, `location`, `www-authenticate`, `mcp-session-id` and
`retry-after`.

| Method | Path | Authenticated by |
| --- | --- | --- |
| `GET` | `/.well-known/*` | Public metadata |
| `POST` | `/api/auth/oauth2/register` | Open dynamic registration, rate-limited per client IP |
| `POST` | `/api/auth/oauth2/token`, `/api/auth/oauth2/revoke` | PKCE verifier, refresh token or the token itself |
| `GET`, `POST`, `DELETE` | `/mcp/<site>` | Bearer token whose audience is that site |

**Browser routes.** The consent flow runs with an assertion like every other request, as the
asserted user: `GET /api/auth/oauth2/authorize`, `GET /consent`, `GET /api/auth/oauth2/public-client`
and `POST /api/auth/oauth2/consent` (same-origin JSON). The live editor uses
`GET /api/sites/<id>/events` (server-sent events) and `DELETE /api/sites/<id>/connections/<app>`
(Disconnect). Every other `/api/auth/*` route stays closed (403).

**Who approves.** The runtime mirrors each asserted user into a local user row (email
`<sub>@gateway.invalid`) that owns their consents and tokens, anchored to one session row per user
that no browser holds. Every gateway user may connect every site of the instance.

**Client IP.** Set `x-lacuno-client-ip` on every forwarded request, overwriting any value the client
sent. The runtime's OAuth rate limits (register 5, token 20, authorize 30 per minute) key on it.

**Revoking a user.** `POST /api/gateway/revoke-user` with `{"userId":"<sub>"}` deletes that user's
consents, revokes their tokens, removes their mirror row, anchor session and remembered role, and
closes their open MCP sessions. It answers `200 {"consents":n,"tokens":n,"sessions":n}`, with zeros when there is
nothing left to revoke; 400 for an invalid body; 401 for a missing, invalid or replayed assertion;
403 for an assertion without `system`. Its assertion is a normal one with `system: true`
(conventionally `sub` `lacuno-cloud`), sent without an `Origin` header and never on behalf of a
browser. The runtime refuses a `system` assertion (401) on every other route.

**Client ID Metadata Documents.** A runtime without internet access fetches them through the relay
in `LACUNO_CIMD_RELAY_URL`. Without it, gateway mode offers dynamic registration only and does not
advertise `client_id_metadata_document_supported`. Each fetch is `POST <relay>` with
`{"url":"https://…"}` and `authorization: Bearer <jwt>`, an HS256 JWT signed with the gateway
secret whose claims are `iss` (the editor origin), `aud` `lacuno-cimd-relay`, `url` (the body's URL),
`iat` and `exp` at most 30 seconds later. The relay answers with the upstream status, content type,
cache control and body, never following redirects, or refuses with 400, 401, 429 or 502,
`x-lacuno-relay-error: <code>` and `{"error":"<code>"}`; a refusal fails the app's authorization
with `invalid_client`.

**Export to an edge.** With `LACUNO_EXPORT_URL` set (it requires the gateway settings), the runtime
copies every published release to that sink. After a build, before the release becomes ready, each
file in its output goes up as `PUT <export>/sites/<site>/<key>` (`application/octet-stream`): files
under `assets/` and `_astro/` as `immutable/<path>`, after a `HEAD` of the same URL answers 404, and
everything else as `releases/<release>/<path>`, each path segment URL-encoded. The sink answers 204,
and anything else fails the release. Each time a release is published, restored, promoted or sent to
testing, `PUT <export>/sites/<site>/pointer/<production|testing>` with the release id as its body
follows from an outbox, retried with backoff until the sink answers 204. At start the runtime queues
the current releases it has not exported yet. Every asset written to a site (an upload, an
imported file or a new site's own) also goes up as `PUT <export>/sites/<site>/asset/<hash>` before
the request that wrote it answers, and a failure fails that request, so a document never refers to
an asset the sink does not keep. When a save changes the assets a site's document lists (and once
for every site after the upgrade that added it), `PUT <export>/sites/<site>/assets` sends their
hashes, sorted, one per line, from an outbox retried with backoff until the sink answers 204; Cloud
counts the files a site lists as its workspace's storage. Every request carries `authorization: Bearer <jwt>`,
signed like the relay's with `aud` `lacuno-export` and the claims `site`, `key` (as in the URL) and,
for `PUT`, `sha256` (the body's lowercase hex SHA-256).

The proxy is a full trust boundary: anyone with its signing key can act as the managed owner. Protect
and rotate keys deliberately, synchronize clocks and prevent direct public runtime access. This
protocol is not OIDC, fine-grained authorization or per-user document attribution. Each workspace
needs separate data and keys. Default local-owner behavior is unchanged when gateway mode is absent.
