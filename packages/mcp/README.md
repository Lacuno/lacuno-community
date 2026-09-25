# @lacuno/mcp

MCP tools and resources over a Lacuno site folder, served on stdio by `lacuno mcp [dir]`, and
over a server site at `/mcp/<site id>` (Streamable HTTP, OAuth).

| Tool | What it does |
| --- | --- |
| `guide` | The document model, the workflow and the operation catalog; pass `group` for its schemas. |
| `document.read` | Revision and overview: site, pages, folders, classes, breakpoints, tokens, components, collections, assets. |
| `page.outline` | Indented node tree of a page or component with ids, tags, classes and text snippets. |
| `node.get` | One node and its subtree. |
| `styles.get` | Style declarations by class, breakpoint and state. |
| `entries.list` | A collection's entries in order. |
| `document.apply` | An atomic batch of operations against the revision you read; `dryRun` returns the patches. |
| `document.diff` | Readable summary of what a batch would change (dry run) or of the changes since another `lacuno.json` in the site folder (`against`); `json: true` for structured output. |
| `asset.import` | Stores a file from the site folder (`path`) or base64 bytes (`data`) and registers the asset. |
| `page.preview` | A route's full HTML as published, without a build; `text: true` gives `nodeId<TAB>text` per text node. |
| `page.screenshot` | PNG of a route at `width` (default 1280), the full page unless `height` is set, or cropped to `node`. Lazy images are loaded and decoded before capture, so images below the fold are not blank. Requests to any other origin are aborted, so embeds and custom code reach no third party. |
| `site.build` | Builds the site folder to static output. `siteUrl` applies only when the document has no `site.url` of its own. |
| `site.publish` | Server only, in place of `site.build`: publishes the draft to the testing address and returns its URL. |

Resources: `lacuno://schema/document` and `lacuno://schema/operations`, the JSON Schemas of the
document and of `document.apply` operations.

`page.screenshot` uses Playwright's Chromium, an optional peer dependency. Install it in the project
that runs the server with `pnpm add -D playwright && npx playwright install chromium`; the other
tools work without it.
