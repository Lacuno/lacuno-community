# Freeflow editor

The first visual editing milestone: sign in, create a site, open a page, select an element, edit its
plain text or class styles, and save. Reloading retrieves the persisted document from the server.

From the repository root:

```sh
pnpm install
pnpm setup:env
pnpm dev
```

Open `http://localhost:3000` (or your configured server URL). Create an account if registration is
enabled, then create a site from the default template. `pnpm dev` builds the editor and starts the
server at the same origin, so sessions and API requests require no development CORS exception.

For frontend development, run `pnpm --filter @freeflow/editor dev` in a second terminal. It watches
and rebuilds the editor; refresh the browser to see changes. The server's watcher handles backend
changes. Production builds use `pnpm build`, followed by `pnpm --filter @freeflow/server start`.

## Editing

- Choose a page in the left panel. Collection pages also offer an entry selector.
- Click the canvas or a layer to select an element. Desktop, tablet and mobile buttons change the
  iframe viewport; the canvas scales to fit available space without changing its media-query width.
- Edit plain text in the inspector. Structured rich text and content bindings remain read-only.
- Pick an assigned class and edit a supported CSS property. This first panel edits the base
  breakpoint's default state. Class changes affect all elements sharing that class. Empty values
  remove the explicit declaration; token values remain intact unless you replace them.
- Save changes to commit one version-pinned operation batch. Unsaved drafts warn before switching
  selection or page. A stale save keeps your draft and asks you to reload; it never overwrites newer
  changes. Reloading discards the draft after confirmation.
- Undo/redo buttons reverse saved batches, including text and styles changed together. Use
  `⌘/Ctrl Z` to undo and `⌘/Ctrl Shift Z` (or `Ctrl Y`) to redo, in the editor or canvas. Text fields
  retain their native text undo. Save or discard a draft before undoing a saved edit.
- History holds the latest 100 saves in the open editor. A new edit clears redo; reloading or leaving
  the site clears history. Undo/redo writes a new revision through the same API and rejects stale
  revisions rather than reverting someone else's work. Original token values and cleared styles
  are restored, not reconstructed from computed CSS.

## Canvas rendering

`@freeflow/renderer` calls the compiler's pure HTML renderer and the existing CSS generator.
Canvas-only node attributes support selection; they are absent from published output. Assets use
authenticated site URLs and their original bytes, while published builds still use Astro image
optimization. Component definitions and collection lists use the same rendering logic in both paths.

The React shell hosts an iframe with `sandbox="allow-same-origin"` and no script permission. A CSP
also blocks scripts, forms, embedded frames and external resources in the canvas. Parent-side event
listeners handle selection and suppress link navigation. Site scripts cannot access the editor.

This is a minimal editor: adding/moving elements, assigning new classes, rich-text editing, visual
breakpoint/state editing, collaborative Yjs undo, git history and publishing are subsequent milestones.
The editing workspace currently targets desktop browsers; its mobile button previews the site.

## Verification

```sh
pnpm --filter @freeflow/renderer test
pnpm --filter @freeflow/server test
pnpm --filter @freeflow/editor typecheck
pnpm --filter @freeflow/editor test
```

Renderer tests compare all fixture and default-template pages and entries with compiler markup and
CSS. Server tests cover preview/asset access control. A Playwright test covers account creation,
canvas selection, text/style edits, reload persistence, stale-write protection, mobile viewport,
collection previews, sandbox isolation, undo/redo, sign-out and sign-in. Unit tests exercise inverse
batches, restoration of rich text and typed CSS, history bounds and branching, and shortcuts.
The browser test saves a desktop screenshot under
`.freeflow/editor-preview/` for visual inspection.
