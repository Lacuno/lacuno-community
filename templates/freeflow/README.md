# Freeflow starter

This folder is a complete, editable Freeflow marketing-site starter. It includes Home, About and
Blog pages, a collection-backed article template, three sample articles, shared navigation and
footer components, and a reusable paper/ink/lime design system. The source stays in native
Freeflow data rather than HTML embeds or page-specific code.

## Copy and build

Copy this folder to a persistent location of your choice, then build it from the Freeflow
repository root:

```sh
cp -R templates/freeflow /absolute/path/to/my-site
pnpm --silent freeflow build /absolute/path/to/my-site
```

The compiler writes the static site to `dist/` inside the copied site folder. The generated
directory is disposable; `freeflow.json` is the editable source.

To connect an MCP client over stdio, launch the server from the repository root:

```sh
pnpm --silent freeflow mcp /absolute/path/to/my-site
```

The client owns that process. It should read the current document revision before sending
version-pinned `document.apply` calls.

## What to customize

- Edit Home, About and Blog page nodes for your own story and calls to action.
- Change the color, typography, spacing and size design tokens to establish your visual system.
- Update the shared header and footer components once to change navigation across every route.
- Replace the three entries in `col-posts` with your own articles. Each entry stores `title`,
  `slug`, `summary`, `body` and `url`. Update `slug` and `url` together so article routes and Blog
  links continue to match.
- The Home preview has stable nodes for adding a rendered page image: `n-home-preview-frame` is
  the parent frame and `n-home-preview-fallback` is the editable fallback content.

The hosted browser builder and Freeflow-operated hosting service described in the copy are
planned work. The template does not imply current availability, pricing or a specific allowance.
The primary “Explore Freeflow” action currently links to `/about` because no public project
destination was verified during authoring.

## MCP authoring evidence

The initial empty document was created once with `DocumentStore.create`, the required bootstrap
exception before an MCP server can open a site. Every later content and style mutation was sent
through an SDK `Client` connected to the real Freeflow stdio server. The client launched
`pnpm --silent freeflow mcp <absolute-site-directory>` and did not import the document engine,
call `store.apply`, or write completed document JSON.

Task 3 began at revision 1. A design-system batch produced revision 2; a shared-component,
collection and entry batch produced revision 3; and the page batch produced revision 4. The
first page attempt was atomically rejected because one text-node payload omitted its tag. The
payload was corrected and retried through MCP without editing `freeflow.json` directly. A final
copy refinement produced revision 5 through `node.update`. Review then found a negative root
margin that conflicted with the compiler's body reset; two `style.clear` operations removed that
margin and the unnecessary overflow mask, producing revision 6.

Readback through MCP covered all four page outlines, all three collection entries, the shared
style set, the preview frame subtree and the final document. `site.build` reported six pages and
no warnings. The six routes are `/`, `/about`, `/blog`,
`/blog/your-website-your-rules`, `/blog/from-document-to-website` and
`/blog/hosted-or-self-hosted`.

No external images or fonts are included, so there is no asset attribution requirement. The
system font stack avoids third-party requests. Node 24 may print the repository’s known
unsettled-top-level-await warning when the MCP client closes after successful calls; the calls
and persisted results still complete before that warning.
