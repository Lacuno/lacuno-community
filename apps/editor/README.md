# Freeflow editor

The first visual editing milestone: sign in, create a site, open a page, select an element, edit its
plain text or class styles, and save. Reloading retrieves the persisted document from the server.

From the repository root:

```sh
pnpm install
pnpm setup:env
pnpm dev
```

Open `http://localhost:3000` (or your configured server URL). On a fresh private instance, run
`pnpm owner:token` in another terminal and enter the one-time token in the owner setup form.
Registration closes automatically after setup. Existing users sign in as usual. Then create a site
from the default template. `pnpm dev` builds the editor and starts the
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
- Edit plain text in the inspector or rich text directly on the canvas. Content bindings remain read-only.
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
  spacing and borders, **Appearance** for colors, and **Effects** for visual treatments, and **Motion** for animation. Other groups stay available in the Design
  inspector. **Insert** opens the existing element palette. The ribbon and inspector share the same
  editing state, so changing categories preserves pending edits.
  No class setup is required. A private local style is created automatically; shared styles stay
  unchanged. Empty fields show the computed canvas value as a hint and retain the existing style.
  Bare numeric sizes use pixels. Choose **Reset formatting** to clear local adjustments at the active breakpoint;
  resetting and formatting both support undo/redo. Project colors remain linked references.
  Local rules take precedence over shared rules in both canvas and published CSS. Component
  definition edits still affect all instances, as indicated in the inspector.
- Desktop, Tablet, and Mobile select the matching document breakpoint as well as the canvas width.
  Formatting writes only to that breakpoint. Wider rules remain inherited until overridden, with
  purple fields marking tablet/mobile overrides and the inspector naming the active scope. Reset clears
  only that breakpoint. Desktop base edits remain visually neutral. Switching sizes flushes pending edits before changing scope. Text, project
  colors, and preset assignments remain shared. Effects, motion, and preset updates use the same
  breakpoint scope, and all responsive edits support undo/redo.
- **Effects** provides opacity and scale percentages, rotation, and X/Y tilt with an 800px
  perspective. Box shadows use a popover with horizontal/vertical offsets, blur, spread, color,
  and inset controls. Existing custom transforms and complex shadows remain editable as CSS.
  Effects preview immediately, autosave, support undo/redo, and reset with **Reset formatting**.
  Rotation and scale use individual CSS properties, so they compose with existing transforms.
- **Motion** configures duration, delay, and easing, which apply to entrances and to state changes
  alike. Entrances include fade and slides from four directions, played once when an element
  enters the viewport. **Preview entrance** replays one in the sandboxed canvas.
  Reduced-motion preferences disable motion in both preview and published output. Published
  entrance animations use a small IntersectionObserver script; content remains visible without
  JavaScript or observer support. Motion settings autosave, support undo/reset, and travel with presets.
  The former hover shortcut (hover opacity, scale, rotation, and shadow) is gone: write those in the
  Hover state instead. Documents that used it are rewritten into real hover and focus-visible
  declarations when they are read.
- **States** are picked beside the breakpoint label in the Design inspector: None, Hover, Focus,
  Focus visible, Active, Visited, First child, Last child, Odd and Even. Every style control then
  reads and writes that state's declarations for the selected element, purple fields marking the
  ones this state owns. The canvas forces the picked state on the selected element so you can see
  it without hovering; switching state discards pending edits, as switching breakpoint does.
  Published CSS carries the real pseudo-class rules and nothing about the forced preview.
- **Presets** in the Design inspector reuse typography, colors, spacing, borders, and effects across breakpoints. Create
  one from the selected element, then apply it immediately from the picker on other elements.
  Applying a preset replaces local formatting across all breakpoints; choosing **No preset** removes its link.
  Subsequent formatting stays local. **Reset to preset** clears those adjustments, while
  **Update preset** merges them into the shared preset and displays the number of affected elements.
  Other elements keep their own local overrides. Color references stay linked. Preset creation,
  application, reset, and updates support undo/redo. New presets retain responsive formatting. Updating or resetting a preset affects only the active
  breakpoint; preset assignment remains shared across sizes. Presets capture base-state formatting only.
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
  the site clears history. Undo/redo replays that save's patches, inverted, through the same API and
  rejects stale revisions rather than reverting someone else's work. Original token values and cleared styles
  are restored, not reconstructed from computed CSS.

## Rich text and links

Editor layout/control styles live in `editor-chrome.css`; `style.css` contains global primitives
and account/site-selection screens. The shared text toolbar owns `text-toolbar.css`.
`Inspector.tsx` owns selection drafts and formatting; `Editor.tsx` coordinates documents,
navigation, saving, and history. Inline style names and supported values are shared with the
compiler through the schema package, so a valid inline draft survives rendering after save.

Select a text element to format the whole text, or double-click it on the canvas and select words.
Both modes use the same Home toolbar for font, size, bold, italic, color, and links. A scope label
shows whether changes affect selected words or the whole text (including when only a caret is placed).
Alignment and line height always affect the whole block. Presets remain visible but are disabled
during an inline editing session. Links open in a popover without expanding the ribbon.
Link destinations can be a static page,
an HTTP(S) URL, email (`mailto:`), telephone (`tel:`), or section anchor (`#section`). Internal links
store page IDs and resolve the current path when rendered, including after page URL changes.
Bound collection text and locked elements remain protected.

Done saves the inline editing session as one document-history entry; navigating to another element
or page also saves pending text. Cancel restores the original content. While editing, use the text
toolbar or keyboard shortcuts for local undo/redo; after saving, use the editor's normal history.
The plain-text inspector remains available for unformatted text. Text with inline marks is edited
on the canvas so its formatting is preserved.

## Canvas rendering

`@freeflow/renderer` calls the compiler's pure HTML renderer and the existing CSS generator.
Canvas-only node attributes support selection; they are absent from published output. Assets use
authenticated site URLs and their original bytes, while published builds still use Astro image
optimization. Component definitions and collection lists use the same rendering logic in both paths.

The React shell hosts an iframe with `sandbox="allow-same-origin"` and no script permission. A CSP
also blocks scripts, forms, embedded frames and external resources in the canvas. Parent-side event
listeners handle selection and suppress link navigation. Site scripts cannot access the editor.

## Publishing

The header's **Publish** button saves pending edits and opens a compact publishing dialog. Publish
the saved revision, follow its queued/building/ready/failed status, inspect errors and warnings, and
open the published URL. You can close the dialog and keep editing during a build; the live site
uses the captured snapshot. Release history survives restarts. Restoring a successful release asks
for confirmation and changes only the live site, leaving your editing draft untouched.
Release labels use a separate per-site counter (v1, v2, …), independent of document revisions.
Failed publish attempts retain their version number; rollback restores the original version.

Published content is served on a separate origin. Local defaults use `<site-id>.localhost:3001`;
see [server configuration](../server/README.md#publishing) for deployment requirements.
Realtime Yjs sync and git history remain subsequent milestones.
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
collection previews, sandbox isolation, insertion, sibling moves, class assignment, shared colors and variants, color conflicts, slow and failed autosaves, navigation flushes, undo/redo, sign-out and sign-in. Unit tests exercise undo
patches, restoration of rich text and typed CSS, history bounds and branching, and shortcuts.
The browser test saves a desktop screenshot under
`.freeflow/editor-preview/` for visual inspection.
