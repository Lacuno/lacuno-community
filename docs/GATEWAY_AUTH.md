# Authenticated gateway mode

Ordinary self-hosting uses local-owner setup and needs none of this configuration. Gateway mode is an
explicit integration for operators whose trusted reverse proxy authenticates users and authorizes
every request. It does not add managed domains, billing or a hosted control plane to Community.

Set both `MIRALO_GATEWAY_ISSUER` (the gateway's exact origin) and `MIRALO_GATEWAY_SECRET` (at least
32 characters of independently generated secret material), with `BETTER_AUTH_URL` set to the exact
public editor origin. Keep the runtime private behind the proxy and use HTTPS outside local development.
The gateway and runtime must agree on that origin as the assertion audience.

Initialization requires an instance without local accounts. It creates a passwordless managed owner;
all gateway-authorized users act with that owner's access. It disables local signup, owner setup and
local auth endpoints except the verified session-profile endpoint. Gateway mode, issuer and audience
are persisted: removing configuration or changing identity cannot reopen local setup. Existing owner
instances require a separately designed migration; no automatic conversion or data deletion occurs.

## Request protocol (version 1)

For every request, the proxy strips browser cookies and any supplied `X-Miralo-Assertion`, then
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

Do not send assertions to the browser or place them in URLs. Re-sign retries with a new nonce.
`GET /health` and `/api/config` are public readiness/configuration endpoints; editor HTML, assets and
management APIs require assertions. `/api/config` reports `authentication: "gateway"` and
`gatewayProtocol: 1`. `GET /api/auth/get-session` returns the verified identity profile, not a local
browser session. The gateway owns browser logout and immediate session/membership revocation.

The proxy is a full trust boundary: anyone with its signing key can act as the managed owner. Protect
and rotate keys deliberately, synchronize clocks and prevent direct public runtime access. This
protocol is not OIDC, fine-grained authorization or per-user document attribution. Each workspace
needs separate data and keys. Default local-owner behavior is unchanged when gateway mode is absent.
