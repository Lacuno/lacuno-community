# Decision log

Each entry: the decision, the alternatives, why. Add new entries at the bottom. Reversing a decision
gets a new entry that references the old one.

## D001. Greenfield, not a Webstudio fork

**Alternatives.** Fork Webstudio (AGPL) and change output, hosting and agent layer.

**Why.** Webstudio's architecture is coupled to Remix, Postgres and their Cloudflare cloud, and the
builder is not built for self-hosting. The parts we would keep, the data model shape and the MCP
design, are ideas rather than code. The cost of unwinding the rest exceeds building the core. We
borrow the shape of their model and ship an importer for their clipboard format.

## D002. A typed JSON document is the source of truth, Astro is a compile target

**Alternatives.** Astro files as the source with a visual editor that round-trips them (Onlook
model). Arbitrary HTML as the source (GrapesJS model).

**Why.** Bidirectional sync between a visual editor and arbitrary code is the hardest problem in
this space and never feels solid. A schema-defined document gives reliable agent edits, clean
diffs, and a swappable output target. Custom code enters through code components and embeds,
never by editing generated files.

## D003. Class-based styling with a breakpoint cascade, not per-element styles

**Alternatives.** Per-element styles (Framer). Utility classes (Tailwind as the model).

**Why.** Classes produce readable CSS, teach the box model, and keep large sites consistent.
Tailwind is supported as an import format, not as the internal model.

## D004. Static output by default

**Alternatives.** SSR app output.

**Why.** Marketing sites, blogs and docs are the target. Static HTML on a CDN is faster, cheaper
and safer. Form submissions are the one runtime endpoint and live on the Lacuno instance. Islands
cover interactivity. Dynamic per-request rendering is out of scope.

## D005. Sites are git repositories

**Alternatives.** Document rows in a database with a homegrown history table.

**Why.** Versioning, branches, proposals, previews and rollback come for free and are already
trusted. Agent proposals become branches. Leaving Lacuno is a clone. The database holds
accounts, CMS content and form submissions; the design document lives in git. CMS content is
also exported to the repository on publish so the repository is always a complete site.

## D006. Yjs CRDT for the live document

**Alternatives.** Plain state with an operation log; add multiplayer later.

**Why.** Undo and redo, multiplayer and agent co-editing all fall out of one mechanism.
Retrofitting a CRDT is painful. The Yjs document is serialized to JSON for git commits.

## D007. React for the editor

**Alternatives.** SolidJS, Svelte.

**Why.** The editor ecosystem lives in React: dnd-kit, Radix, Tiptap, Yjs bindings, and the
contributor pool. Performance is managed with an iframe canvas, virtualized trees and careful
subscriptions rather than by framework choice.

## D008. SQLite first, Postgres optional

**Alternatives.** Postgres only.

**Why.** One container with no external services is the self-host promise. Drizzle keeps the
schema portable so Postgres is a config switch for larger deployments.

## D009. Agents are users with proposals (superseded by D016)

**Alternatives.** Agent edits apply directly. Agent edits require per-mutation confirmation.

**Why.** Direct edits are unsafe; per-mutation confirmation is unusable for real work. Proposals
let an agent do a whole task, then a human reviews a rendered diff and accepts, edits or rejects.
The same mechanism serves human branches. Direct mode exists behind an explicit opt-in.

## D010. AGPL-3.0-or-later for everything, no open core

Clarified by D014: this repository remains AGPL; managed infrastructure is a separate Cloud scope.

**Alternatives.** MIT or Apache. Open core with proprietary hosting features.

**Why.** AGPL keeps hosted forks contributing back while leaving self-hosting and commercial use
free. No open core because the split is what makes people distrust open source builders. A paid
hosted offering can exist as a service, not as withheld features.

## D011. MCP ships in the first phase, before the editor is good

**Alternatives.** Add agent features after the editor is complete.

**Why.** The MCP server is a thin layer over the document schema, so it is cheap early. It lets
agents build the first templates, tests the schema under real use, and makes agent-native a
property of the foundation rather than a feature added later.

## D012. Astro is an internal engine, not an editable output

**Alternatives.** Generate a normal Astro project a developer can open and modify, as D002 and
the first architecture draft described. Generate `.astro` source from the document.

**Why.** An editable Astro project promises two-way ownership we cannot honor: the next build
overwrites it, and every generated file becomes API surface. Treating Astro as an engine keeps
the renderer a pure function over the document, tested without a bundler, and leaves Astro to do
what it is good at: image optimization, CSS bundling, compressed HTML, sitemaps and redirects.
Developers extend a site through embeds and code components, which are inputs, not outputs.
Reverses the "normal Astro project" language in D002 and the architecture doc; the JSON document
remains the source of truth.

## D013. No third-party font hosting

**Alternatives.** A `google` font source that links the Google Fonts stylesheet, as the first
schema draft had. A generic remote-stylesheet source for any provider.

**Why.** Loading a font from a third party sends every visitor's IP address to that party on
every page view. The Munich Regional Court ruled in 2022 that doing so with Google Fonts without
consent violates the GDPR, and a self-hostable tool aimed at European users cannot ship that as a
default path. Self-hosting is also faster: no cross-origin connection, no render-blocking
stylesheet. Fonts are therefore either uploaded assets served from the site or system font stacks.
A font picker that downloads open-licensed fonts into the asset library at design time gives the
same convenience without the runtime request, and belongs in the editor phase.

## D014. Community provides the builder; Cloud operates the infrastructure

**Decision.** Community retains the editor, compiler, export and self-hosted publishing, history and
rollback. We provide a container and self-hosting instructions. Operators configure their own DNS,
reverse proxy, HTTPS, backups, monitoring and upgrades. We do not build integrated domain/TLS
management into Community. A future paid Cloud service takes care of those operational tasks.

**Why.** Self-hosting remains useful and unrestricted; the commercial value is managed setup and
ongoing operation. We do not try to prevent operators from using their own domains. This narrows
the earlier one-command-with-TLS promise in the vision and Phase 1 exit condition. Cloud is planned,
not shipped; its eventual code/license boundaries require separate review. No repository code is
relicensed by this decision.

## D015. Community keeps authentication with a private owner setup

**Decision.** Keep Better Auth for Community passwords and sessions. A new private instance uses
a server-side one-time token to create one owner account, then closes registration. SQLite enforces
the single-owner constraint. Existing accounts and deliberately configured legacy registration are
preserved; opening registration is not the default onboarding path. Cloud can add organizations,
invitations, roles, billing and managed recovery separately.

**Why.** Authentication protects the editor and publish controls on an internet-reachable instance.
Removing it would shift that protection onto operators or require us to maintain password/session
security ourselves. A setup token prevents the first visitor from claiming an unconfigured server.

## D016. The user's own AI app is the agent; edits land live on the canvas

Supersedes D009.

**Alternatives.** Lacuno calls a model with the instance's key (bring your own key, Ollama).
Agent work lands as proposals reviewed in a diff.

**Why.** Everyone already pays for Claude, ChatGPT or an AI editor, and those apps speak MCP.
Lacuno therefore never calls a model and never holds a key: the editor's Connect your AI
button registers a per-site MCP endpoint in the user's app, protected by OAuth issued by the
same server. Agent batches stream into the open editor and land on the canvas as they happen,
which is the review; the designer's own draft is never overwritten and their undo history stays
theirs. A proposal flow would double the mechanism for little safety, since every batch is
version-pinned, logged and undoable by a later batch. Production publishing and site deletion
remain human-only actions and are not exposed as tools.

