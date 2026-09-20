# Freeflow Cloud boundary

Cloud development lives in a separate `freeflow-cloud` repository. Its local implementation includes
accounts, workspace ownership and a worker that provisions isolated Community containers. Secure
editor handoff and managed publishing remain to be built; it is not a deployed hosted product.

Community retains the editor, document model, compiler, export, self-hosted publishing, release history
and rollback. Cloud will manage accounts, workspace infrastructure, routing and eventually paid
operational features such as domains/TLS, backups and upgrades. Community operators remain free to
configure these themselves using the [self-hosting guide](SELF_HOSTING.md).

The provisional Cloud architecture runs one existing Freeflow runtime per customer workspace, with
separate data and secrets. Cloud must not copy the editor or write directly into runtime databases.
Its first target is signup → workspace/site → existing editor → managed published URL.

## Integration work still required

- Generic, opt-in external identity support for secure editor sign-in, including membership revocation
  and an explicit relationship to the single-owner constraint. Local-owner setup remains the default.
- Minimal runtime-scoped management capabilities where orchestration needs them. Current management
  APIs use user sessions; an internal Cloud contract is not an implemented Community API.
- Ownership-verified edge routing to the separate published listener, reusing current release behavior.

Owner setup tokens are not Cloud SSO. Do not share session cookies across published sites, weaken
private setup, or use stored owner passwords as the integration boundary.

Community licensing is unchanged. Cloud's eventual license and the actual service integration require
separate review; a second repository alone does not settle the licensing boundary. See decisions
D014 and D015 in [DECISIONS.md](DECISIONS.md).
