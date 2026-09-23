# Feature map

Legend: **MVP** ships in the first usable release. **Next** follows once MVP is stable. **Later** is
committed but not scheduled. **Deferred** means we have decided not to build it yet and say why.

## Design

| Feature | When | Notes |
| --- | --- | --- |
| Canvas in an isolated iframe with click, drag, resize, marquee select | MVP | Editor chrome never leaks CSS into the site |
| Layer tree (navigator) with drag reorder, rename, hide, lock | MVP | |
| Element palette: div, section, container, heading, paragraph, text span, link, button, image, video, list, form controls, embed | MVP | Semantic tag is chosen per element, not implied by a component name. In: section, container, stack, row, grid, list, heading, paragraph, span, image, video, embed, link and button, plus Wrap selection in any structure or a link. A link and a button are both `a` elements; a form button waits for forms, as do the other form controls |
| Style panel: box model, size, position, display, flex, grid, typography, backgrounds, borders, shadows, effects, transforms, overflow, cursor | MVP | Every CSS property reachable, common ones with visual controls |
| Classes and combo classes | MVP | Webflow model. Styles attach to classes, elements reference classes |
| Breakpoint cascade | MVP | Desktop-first base with tablet, mobile landscape, mobile portrait. Custom breakpoints. Container queries as a per-element option |
| States: hover, focus, focus-visible, active, visited, disabled, checked, first, last, nth, placeholder, before, after | MVP | The picker offers hover, focus, focus-visible, active, visited, first, last, odd and even; the rest wait for form controls in the palette and a content field |
| Design tokens: color, spacing, typography, radius, shadow, with modes such as light and dark | MVP | Compiled to CSS custom properties. In: color, spacing, size, typography, radius and shadow in the Design tokens dialog, a token button on every matching style field, and canvas spacing and size handles that snap to tokens. Border and motion groups, and per-mode values for non-colour tokens in the dialog, wait |
| Fluid typography and spacing with clamp | MVP | A design token can be a scale, not just a value |
| Components with props, slots and variants | MVP | Instance overrides are explicit and visible in the tree |
| Rich text editing on canvas | MVP | Tiptap. Same editor used in CMS rich fields |
| Copy and paste of HTML plus CSS, Tailwind HTML, Webflow clipboard, Webstudio JSON, SVG, images | Next | Import is how people switch. Tailwind paste is how AI output gets in |
| Scroll-driven and view-timeline animations, transitions | Next | Native CSS. No engine of our own |
| View transitions between pages | Next | Astro ships this |
| Interactions timeline editor | Deferred | Native CSS covers most of the demand. Revisit with real user requests |
| Multi-canvas showing several breakpoints side by side | Later | |

## Structure

| Feature | When | Notes |
| --- | --- | --- |
| Pages, folders, nested routes, page settings | MVP | In: pages, page settings and site settings. Folders and nested routes in the Pages panel wait |
| Page templates and reusable layouts | MVP | A layout is a component with a page slot |
| Per-page SEO: title, description, canonical, robots, OG and Twitter meta | MVP | In: title, description, canonical, hide from search engines, social image and page code in page settings; Open Graph, `og:locale` and `twitter:card` in the head. Twitter title, description and image fall back to Open Graph |
| Generated OG images from a template | Next | Rendered at build time |
| Sitemap, robots.txt, redirects, 404 and 500 pages | MVP | In: sitemap without hidden and not-found pages, robots.txt, redirects edited in Site settings (published as Astro's meta-refresh pages), and a not-found page at `/404` built to `404.html`. Still to come: redirects emitted for Caddy, Netlify and Cloudflare formats, and a 500 page |
| Structured data presets: Article, Organization, Product, FAQ | Next | |
| Localization: locale-aware routes, translated fields, hreflang | Later | Data model reserves it from day one |

## Content

| Feature | When | Notes |
| --- | --- | --- |
| Collections with typed fields: text, rich text, number, boolean, date, image, file, color, option, reference, multi-reference, slug | MVP | Native. SQLite storage |
| Collection templates and collection lists with filter, sort, limit, pagination | MVP | Built into the data model, compiled to `getStaticPaths` |
| Content editor mode: edit text and CMS fields on canvas without touching design | MVP | Role gated |
| Draft, scheduled and published states | Next | |
| Markdown and MDX folder as a collection backend | Next | Git-native content for developers |
| External sources: REST and GraphQL as read-only collections | Later | Same binding model as native collections |
| Import from CSV and from Webflow CMS export | Next | |

## Forms and assets

| Feature | When | Notes |
| --- | --- | --- |
| Form builder with validation, honeypot, submissions stored on the instance | MVP | Submissions are the one runtime endpoint the published site needs |
| Email notifications and webhooks on submission | MVP | SMTP or Resend |
| Asset library with folders, upload, drag onto canvas, alt text | MVP | Local disk or S3-compatible |
| Image optimization: responsive sizes, AVIF and WebP, lazy loading | MVP | Astro image pipeline with sharp |
| Font management: self-hosted uploads, system stacks, variable fonts | MVP | Self-hosted only; no third-party font hosts, see D013. In: WOFF2, WOFF, TTF and OTF uploads, one face per file with weight and style, system fonts with a fallback, managed in Site settings and picked from both font fields; published as font-face rules with one preload per family. Variable fonts as one weight range wait |
| SVG and icon sets | Next | |

## Publishing

| Feature | When | Notes |
| --- | --- | --- |
| One-click publish: compile to Astro, build, serve static output from the instance | MVP | |
| Staging and production environments with separate URLs | MVP | |
| Managed custom domains and automatic TLS provisioning | Cloud | Community operators configure their own DNS, proxy and certificates |
| Export the generated Astro project as a zip or push to a git repository | MVP | The escape hatch |
| Deploy hooks for Cloudflare Pages, Netlify, Vercel, GitHub Pages | Next | Push the built output or the Astro project |
| Preview URLs per proposal branch | Next | Every agent proposal and every human branch gets one |
| Incremental builds for large collections | Later | Full rebuilds are fine until they are not |
| Build logs, build history, rollback to a previous publish | MVP | |

## Collaboration

| Feature | When | Notes |
| --- | --- | --- |
| Accounts, workspaces, sites | MVP | |
| Roles: owner, designer, content editor, viewer | MVP | Content editors never see the style panel |
| Undo and redo across the whole document | MVP | Inverse patches of each committed batch |
| Realtime multiplayer with presence | Next | Same Yjs document over WebSocket |
| Comments pinned to elements | Next | Also how humans talk to the agent about a specific element |
| Branches and proposals with visual diff | Next | Git-backed. Agent proposals use the same mechanism |
| Version history and restore | MVP | Every publish and every accepted proposal is a commit |

## Extensibility

| Feature | When | Notes |
| --- | --- | --- |
| Custom code in head and body, per site and per page | MVP | |
| HTML embed element | MVP | In: the palette's Embed with a code field in the inspector; the canvas shows a placeholder where scripts and iframes would run |
| Code components: register real Astro components with a props schema so they appear in the palette | Next | Plasmic-style. Islands for interactivity |
| Plugin API for panels, elements and commands | Later | After the internal API stops moving |
| Template and section marketplace | Later | Templates are just Freeflow documents |

## Agent

See [AGENTS.md](AGENTS.md). Summary of what ships when:

| Feature | When |
| --- | --- |
| MCP server over the document with progressive tool discovery | MVP |
| Screenshot and visual diff tools | MVP |
| In-app agent panel with selection context and canvas proposals | Next |
| Skills stored in the site repository | Next |
| Background jobs: content generation, audits, translation | Later |
| Bring your own key, local models through Ollama | Next |

## Self-hosting and operations

| Feature | When | Notes |
| --- | --- | --- |
| Single Docker image, SQLite, filesystem assets | MVP | Community; see the self-hosting guide |
| `npx freeflow` for local use | MVP | Same binary, no Docker |
| Postgres and S3 as optional backends | Next | |
| Backup and restore documentation | MVP | Operator-managed offline volume backups; managed backups are Cloud scope |
| Health endpoint, structured logs, metrics | MVP | |
| Auth: email and password, magic link, OIDC | MVP for password and magic link, Next for OIDC | better-auth |
