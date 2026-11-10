# @lacuno/mcp

MCP tools and resources over a Lacuno site folder, served on stdio by `lacuno mcp [dir]`, and
over a server site (Streamable HTTP, OAuth). Two versions differ in the tools that change the
site: v2, one tool per operation (D036), at `/v2/mcp/<site id>`; v1, `document.apply` with the
schemas from `guide` (D026), at `/mcp/<site id>` and over stdio, for the apps connected before
v2. `createServer` takes `version`, 2 by default.

| Tool | What it does |
| --- | --- |
| `guide` | v1 only: the document model and workflow, and with `group` a topic's notes (how to build, check, style, write text, model content, make forms, menus and motion, set up the site and translate) or an operation group's schemas. v2 has no guide, so nothing an app reads on how to work comes from a tool's answer: each tool's description says what it needs, the instructions a connection opens with how to work, and the plugin's skills the rest. |
| `document.read` | Revision and overview: site, pages, folders, classes, breakpoints, tokens, keyframes, components, collections, assets, redirects; `parts` names only some. |
| `page.outline` | Indented node tree of a page or component with ids, tags, classes and text snippets. |
| `node.get` | One node and its subtree; `depth` limits how many levels of children come nested, the ones below by id. |
| `styles.get` | Style declarations by class, breakpoint and state. |
| `entries.list` | A collection's entries in order; `limit` and `offset` page through them. |
| `document.apply` | v1: an atomic batch of any operations against the revision you read; answers with the revision, created ids and warnings, and `dryRun` returns the patches. |
| `node.create`, `style.set`, … | v2: one tool per document operation, named like it, taking `changes`, one or more of its kind made in order and all or nothing, and the revision you read as `expectedRevision`; answers with the revision, the ids each change created by its index, and warnings. `asset.create` is not offered (`asset.import` stores the bytes), nor `translation.set` (`translations.apply`). |
| `translations.list` | A language's values to translate, missing and outdated by default, with their context, the glossary terms that apply and the tone; `page` for one page, `cursor` for the next batch. |
| `translations.apply` | Writes up to 500 translations into a language as one atomic batch against the revision you listed; answers how many remain. |
| `document.diff` | v1: readable summary of what a batch would change (dry run) or of the changes since another `lacuno.json` in the site folder (`against`); `json: true` for structured output. |
| `asset.import` | Stores a file from the site folder (`path`), base64 bytes (`data`, small files only) or, on a server site, a public https `url` the server downloads, and registers the asset. Each source is offered only where it works: `path` with a site folder, `url` on a server that can download. |
| `asset.upload` | Server only: a single-use address, valid 10 minutes, that an app with a shell PUTs a local file to (`curl -T`); the answer is the asset. |
| `page.preview` | A route's full HTML as published, without a build and without the site's CSS unless `css: true`; `text: true` gives `nodeId<TAB>text` per text node. |
| `page.screenshot` | JPEG of a route at `width` (default 1280): the first screen (`height`, 800 by default) or with `fullPage` the whole page up to `maxHeight` (4000 px by default); a PNG cropped to `node`, with the fixed and sticky elements outside it hidden. A page wider than the screen is reported with the deepest elements that reach past it. Lazy images are loaded and decoded before capture, so images below the fold are not blank. Requests to any other origin are aborted, so embeds and custom code reach no third party. |
| `site.build` | Builds the site folder to static output. `siteUrl` applies only when the document has no `site.url` of its own. |
| `site.publish` | Server only, in place of `site.build`: publishes the draft to the testing address and returns its URL. |

Resources: `lacuno://schema/document`, the JSON Schema of the document, and in v1
`lacuno://schema/operations`, that of `document.apply` operations.

A failed call is a tool error whose text is JSON, `{ kind, message, ... }`, so an agent can act on
it. `kind` is `stale` (with `expected` and `current` revisions: read again and retry), `operation`
(with the change's `index`, its `type` and, for a refused delete, `referencedBy`), `document` (with
`issues`), `patch`, `build`, `input` or `unexpected`. An `input` error names each refused field by
its path and says what is wrong with it, as `changes.0.value.unit: Invalid option: expected one of
"px"|"rem"…`; a change tool also refuses a field it does not take, such as v1's `dryRun`. An
`unexpected` error has only its message: the stack is logged where the server runs.

Every tool has a `title` made from its name, as `Create node` for `node.create`, both as the
tool's own and as an annotation, beside its read-only, destructive, idempotent and open-world
hints.

Over stdio the client and the server share one machine and one trust boundary: `path` must resolve
inside the site folder, symlinks included, and the server downloads nothing. On a server site the
HTTP endpoint checks each token's site and runs every tool as the user who approved the app.

`page.screenshot` uses Playwright's Chromium, an optional peer dependency, or on the server a
screenshot service (`LACUNO_SCREENSHOT_URL`). Install it in the project that runs the server with
`pnpm add -D playwright && npx playwright install chromium`; without it the tool is not offered and
the other tools work.
