# @lacuno/mcp

MCP tools and resources over a Lacuno site folder, served on stdio by `lacuno mcp [dir]`, and
over a server site at `/mcp/<site id>` (Streamable HTTP, OAuth).

| Tool | What it does |
| --- | --- |
| `guide` | Notes only: the document model and workflow, and with `topic` how to build, check, style, write text, model content, make forms, menus and motion, set up the site and translate. |
| `document.read` | Revision and overview: site, pages, folders, classes, breakpoints, tokens, components, collections, assets. |
| `page.outline` | Indented node tree of a page or component with ids, tags, classes and text snippets. |
| `node.get` | One node and its subtree. |
| `styles.get` | Style declarations by class, breakpoint and state. |
| `entries.list` | A collection's entries in order. |
| `node.create`, `style.set`, … | One tool per document operation (D036), named like it, taking its fields and the revision you read as `expectedRevision`; answers with the revision, created ids and warnings. `asset.create` is not offered (`asset.import` stores the bytes), nor `translation.set` and `translation.delete` (`translations.apply`). |
| `translations.list` | A language's values to translate, missing and outdated by default, with their context, the glossary terms that apply and the tone; `page` for one page, `cursor` for the next batch. |
| `translations.apply` | Writes up to 500 translations into a language as one atomic batch against the revision you listed; answers how many remain. |
| `document.diff` | Site folders only: the changes since another `lacuno.json` in the folder (`against`); `json: true` for structured output. |
| `asset.import` | Stores a file from the site folder (`path`), base64 bytes (`data`, small files only) or, on a server site, a public https `url` the server downloads, and registers the asset. |
| `asset.upload` | Server only: a single-use address, valid 10 minutes, that an app with a shell PUTs a local file to (`curl -T`); the answer is the asset. |
| `page.preview` | A route's full HTML as published, without a build; `text: true` gives `nodeId<TAB>text` per text node. |
| `page.screenshot` | JPEG of a route at `width` (default 1280): the first screen (`height`, 800 by default) or with `fullPage` the whole page up to `maxHeight` (4000 px by default); a PNG cropped to `node`. Lazy images are loaded and decoded before capture, so images below the fold are not blank. Requests to any other origin are aborted, so embeds and custom code reach no third party. |
| `site.build` | Builds the site folder to static output. `siteUrl` applies only when the document has no `site.url` of its own. |
| `site.publish` | Server only, in place of `site.build`: publishes the draft to the testing address and returns its URL. |

Resource: `lacuno://schema/document`, the JSON Schema of the document.

A failed call is a tool error whose text is JSON, `{ kind, message, ... }`, so an agent can act on
it. `kind` is `stale` (with `expected` and `current` revisions: read again and retry), `operation`
(with the operation `type` and, for a refused delete, `referencedBy`), `document` (with
`issues`), `patch`, `build`, `input` or `unexpected`.

Over stdio the client and the server share one machine and one trust boundary: `path` must resolve
inside the site folder, symlinks included, and the server downloads nothing. On a server site the
HTTP endpoint checks each token's site and runs every tool as the user who approved the app.

`page.screenshot` uses Playwright's Chromium, an optional peer dependency, or on the server a
screenshot service (`LACUNO_SCREENSHOT_URL`). Install it in the project that runs the server with
`pnpm add -D playwright && npx playwright install chromium`; without it the tool is not offered and
the other tools work.
