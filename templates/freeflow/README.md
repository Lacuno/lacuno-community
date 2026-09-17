# Freeflow template

This directory contains the in-progress default Freeflow site. The document is intentionally
kept as native Freeflow data so its content and styling remain editable through the document
operations exposed by Freeflow's MCP server.

## Authoring note

The initial empty document was created once with `DocumentStore.create`, the bootstrap
exception required before an MCP server can open the site. Every change after that bootstrap
is sent through an SDK client connected to the real stdio server. The client launches `pnpm`
with `--silent freeflow mcp <absolute-site-directory>` from the repository root and closes the
session in a `finally` block. It does not import the document engine or write document JSON.

The first session successfully called `guide`, `document.read`, and `document.apply`. The
top-level guide returned a short overview and grouped operation index, while `guide` with the
`site` group returned the `site.update` schema. The responses were practical for authoring, so
no guide change was needed. The initial read reported revision 0 and locale `en`. A dry-run
`site.update` to locale `en-US` returned the expected patch, no warnings, and revision 0. A
follow-up read confirmed the document was still at revision 0 with locale `en`. Applying the
same operation against that revision returned revision 1, and the final read confirmed the
locale persisted as `en-US`. The client checks `isError` for every result and stops with the
structured tool message if a call fails; no tool errors occurred in this session. A later
verification session also called `page.outline`, `node.get`, `styles.get`, and `site.build` over
the same stdio transport. The build produced one page with no compiler warnings.

When the client closed, Node printed an unsettled top-level-await warning for the CLI entrypoint
after all responses had completed; the helper still exited successfully. This did not block
authoring or persistence, so it is recorded here rather than changing the CLI in template work.

The configured public repository destination, `https://github.com/Lacuno/Freeflow`, returned
HTTP 404 during authoring. Until a public project destination exists, the template's planned
“Explore Freeflow” action will use the local `/about` route as directed by the implementation
plan. No hosted product URL was inferred from the repository name.
