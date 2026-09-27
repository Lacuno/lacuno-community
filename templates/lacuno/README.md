# Lacuno starter

This folder is a complete, editable Lacuno marketing-site starter. Its source is native Lacuno
data rather than an HTML embed or custom code. It includes three static pages, a collection-backed
article template, three sample articles, shared navigation and footer components, and a reusable
paper/ink/lime design system.

## Copy and build

From the Lacuno repository root, choose a new destination that does not already contain a site:

```sh
mkdir -p "$HOME/LacunoSites"
cp -R templates/lacuno "$HOME/LacunoSites/my-site"
pnpm --silent lacuno build "$HOME/LacunoSites/my-site"
```

The compiler writes the static result to `dist/` inside the copied folder. A build does not publish
the site online. If you copy a working folder that has already been built, omit the generated
`dist/`, `.lacuno/` and `node_modules/` directories; only `lacuno.json`, `assets/` and this
README are needed.

To edit the copied document with an MCP client, run its stdio server from the repository root. The
concrete copied folder must be the final argument:

```sh
pnpm --silent lacuno mcp "$HOME/LacunoSites/my-site"
```

The client owns that process. It should call `document.read`, keep the returned revision, and use
that revision for version-pinned `document.apply` calls. The available server and CLI are enough to
copy, edit and build the starter; no additional package or runtime service is required.

## Structure and customization

The static pages are Home (`/`), About (`/about`) and Blog (`/blog`). The Article page is the
template for the `Posts` collection and produces one route for each entry. `Site header` and
`Site footer` are shared components, so edits to either component affect every page that uses it.
Both show the Lacuno logo, violet in the header and white in the footer, and the site favicon is
its mark. The SVGs are native assets and can be replaced in the editor.

The design tokens are:

- colors: `color.accent`, `color.ink`, `color.line`, `color.muted`, `color.paper`;
- typography: `font.body`;
- radius and size: `radius.small`, `size.content`;
- spacing: `space.xs`, `space.sm`, `space.md`, `space.lg`, `space.xl`, `space.2xl`.

Use MCP read tools such as `page.outline`, `node.get`, `styles.get` and `entries.list` to inspect the
document. Apply node, style, token and component changes through version-pinned `document.apply`
operations. To replace the sample articles, create, update or delete entries in `col-posts` with
`entry.create`, `entry.update` and `entry.delete`. Each entry has `title`, `slug`, `summary`, `body`
and `url` fields. Keep `slug` and `url` in sync: for example, the slug `my-article` needs the URL
`/blog/my-article`, which is also the link emitted by the Blog list.

The Home preview is the image node `n-home-preview-image` inside `n-home-preview-frame`. Its source
is a real 1440 × 900 browser capture of this starter's final About page, imported through the MCP
`asset.import` tool and retaken with Playwright after the rename to Lacuno, keeping its asset ID.
The committed source is
`assets/04a73eca651ccfccdef441fd46bb2f52c8b973321364947a30fff23819226e1c`: asset ID
`An41fLkGaH61`, SHA-256 `04a73eca651ccfccdef441fd46bb2f52c8b973321364947a30fff23819226e1c`,
86,795 bytes and 1440 × 900 pixels. It is project-generated, includes no third-party artwork, and is
distributed with this repository under its AGPL-3.0-or-later license. The starter uses a system font
stack and has no external font or image attribution requirements.

The Lacuno-operated browser builder and hosting service described in the sample copy are planned.
No current availability, price or numeric allowance is promised. Self-hosting the builder and
generated websites remains part of the project direction. The primary “Explore Lacuno” action
links to `/about` because a working public project destination was not available when the starter
was authored.

## Authoring and verification evidence

The initial empty document was created once with `DocumentStore.create` (now `createFolder` from
`@lacuno/document/folder`); this bootstrap exception was necessary before the MCP server could
open a site. Every later content, style and asset mutation
used an SDK MCP client connected to the real stdio command shown above. The client did not import the
document engine, call `store.apply`, or hand-write the completed JSON. The source reached revision
12 through version-pinned MCP operations.

The first page batch was rejected atomically because a text-node payload lacked its tag. The payload
was corrected and retried through MCP. Browser review later exposed a negative root margin hidden by
an overflow mask; both declarations were cleared through MCP. A low-contrast lime-on-paper page
number was changed to ink. The final About capture was imported, bound to the Home preview and the
superseded image removed, all through MCP. On Node 24, the SDK client can print the repository's known
unsettled-top-level-await warning while closing after a successful call; persisted results were read
back before that warning.

For repository contributions, run
`pnpm exec biome format --write templates/lacuno/lacuno.json` after MCP authoring and before
committing. This normalizes serialized whitespace; it does not replace MCP operations for document
content or styles.

Final MCP readback covered all four page outlines, the shared styles and components, the three
collection entries, the preview image and the complete document. `site.build` returned six pages and
no warnings. A separate CLI check copied only this README, `lacuno.json` and `assets/` to a fresh
temporary folder and ran `pnpm --silent lacuno build <absolute-copy-dir> --json`; it also returned
`{"pages":6,"warnings":[]}`.

All six routes returned HTTP 200 in browser checks at 1440, 390 and 320 CSS pixels, with no horizontal
overflow, console errors, page errors, missing h1, skipped heading level or broken internal link.
Keyboard checks at desktop and mobile widths found a visible, working skip link and visible focus
outlines. The rendered color pairs measured from 13.27:1 to 15.99:1 contrast. The responsive Home
preview loaded the final imported image with intrinsic dimensions, alt text, lazy loading and
generated WebP/AVIF variants.

On 2026-09-17, `pnpm lighthouse templates/lacuno` audited the template with Lighthouse 13.4.1,
Node 22.14.0 and Google Chrome for Testing 153.0.8010.12 on arm64 macOS 27.0. The default mobile
preset used a 412 × 823 viewport, device scale factor 1.75 and simulated mobile Slow 4G throttling.
Every route scored 100 in the performance category:

| Route | Performance |
| --- | ---: |
| `/` | 100 |
| `/about` | 100 |
| `/blog` | 100 |
| `/blog/from-document-to-website` | 100 |
| `/blog/hosted-or-self-hosted` | 100 |
| `/blog/your-website-your-rules` | 100 |

These Lighthouse scores cover performance only. The responsive, keyboard, heading, link and contrast
checks above were separate browser QA.
