# Freeflow Cloud boundary

Cloud development lives in a separate `freeflow-cloud` repository. Its local implementation includes
accounts, workspace ownership, isolated Community containers, authenticated editor handoff and
local published-site routing. It is not a deployed hosted product.

Community retains the editor, document model, compiler, export, self-hosted publishing, release history
and rollback. Cloud will manage accounts, workspace infrastructure, routing and eventually paid
operational features such as domains/TLS, backups and upgrades. Community operators remain free to
configure these themselves using the [self-hosting guide](SELF_HOSTING.md).

The provisional Cloud architecture runs one existing Freeflow runtime per customer workspace, with
separate data and secrets. Cloud must not copy the editor or write directly into runtime databases.
Its first target is signup → workspace/site → existing editor → managed published URL.

## Integration work still required

- The generic [authenticated gateway](GATEWAY_AUTH.md) supports fresh managed instances while
  local-owner setup stays the default. Production review, key rotation and finer roles remain.
- Minimal runtime-scoped service capabilities if future orchestration needs them. Current management
  APIs use local sessions or verified gateway requests, not a general infrastructure management API.
- Production edge routing, DNS and TLS; local runtime-scoped published URLs already reuse the
  separate published listener and current release behavior.

Owner setup tokens are not Cloud SSO. Do not share session cookies across published sites, weaken
private setup, or use stored owner passwords as the integration boundary.

Community licensing is unchanged. Cloud's eventual license and the actual service integration require
separate review; a second repository alone does not settle the licensing boundary. See decisions
D014 and D015 in [DECISIONS.md](DECISIONS.md).
