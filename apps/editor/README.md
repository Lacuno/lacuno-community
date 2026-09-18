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
- Use Add element to insert a heading, paragraph, section with starter content, or empty container.
  Choose an explicit destination and optionally reuse a style class. Empty containers can be selected
  in Layers and populated with Inside selection. Move up/down changes the selected sibling order.
  These actions save immediately and support undo/redo with stable element IDs. Locked elements,
  component interiors and collection structure stay protected.
- Edit plain text in the inspector. Structured rich text and content bindings remain read-only.
- Open **Advanced: shared classes** to create, assign or remove reusable classes. Expand a
  class to see the elements and pages/components using it. These changes save immediately and support
  undo/redo; pending formatting must finish first.
- Open **Project colors** to create named colors and explicit variants (for example Brand / Light).
  Existing template colors are available immediately. Pick a project color for `color`,
  `background-color`, or `border-color`, or enter a custom CSS color. Linked styles store token
  references, so editing one color updates every use. Variants are independent, editable values;
  they do not automatically derive from the parent color. Existing site modes can have separate
  values. Color edits support undo/redo, draft protection and version-conflict handling.
- Format the selected element with the contextual ribbon: **Home** for typography, **Layout** for
  spacing and borders, and **Appearance** for colors. Other groups stay available in the Design
  inspector. **Insert** opens the existing element palette. The ribbon and inspector share the same
  editing state, so changing categories preserves pending edits.
  No class setup is required. A private local style is created automatically; shared styles stay
  unchanged. Empty fields show the computed canvas value as a hint and retain the existing style.
  Bare numeric sizes use pixels. Choose **Reset formatting** to clear base/default local adjustments;
  resetting and formatting both support undo/redo. Project colors remain linked references.
  Local rules take precedence over shared rules in both canvas and published CSS. Component
  definition edits still affect all instances, as indicated in the inspector. Named style presets
  and explicit “update style from selection” are a later milestone.
- Text, formatting and existing project colors preview immediately and save automatically after a
  400 ms pause. No Save button is required. Writes are serialized; typing during a request remains
  responsive and queues the latest changes. Switching selection or page flushes pending edits.
  Incomplete/invalid values are kept in the controls until corrected, and failed writes offer Retry.
  Conflicts preserve the local draft and require reloading the latest version. Only drafts that
  cannot be saved need a discard confirmation. Closing the browser warns while changes are pending.
- Undo/redo buttons reverse automatic batches, including text and styles changed together. Use
  `⌘/Ctrl Z` to undo and `⌘/Ctrl Shift Z` (or `Ctrl Y`) to redo, in the editor or canvas. Text fields
  retain native text undo. History becomes available once pending changes finish saving.
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

This is a minimal editor: drag-and-drop layout, class renaming/deletion, rich-text editing, visual
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
canvas selection, direct formatting without classes, reset formatting, text/style edits, reload persistence, stale-write protection, mobile viewport,
collection previews, sandbox isolation, insertion, sibling moves, class assignment, shared colors and variants, color conflicts, slow and failed autosaves, navigation flushes, undo/redo, sign-out and sign-in. Unit tests exercise inverse
batches, restoration of rich text and typed CSS, history bounds and branching, and shortcuts.
The browser test saves a desktop screenshot under
`.freeflow/editor-preview/` for visual inspection.
