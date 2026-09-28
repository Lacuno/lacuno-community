import type { Document } from '@lacuno/schema'

/**
 * Rich-text tables: a region that scrolls sideways when the table is wider than the text, cells
 * aligned to the start and top, and borders mixed from the text colour, so they suit any site.
 * Every rule sits in `:where()`, so the site's own styles win.
 */
export const TABLE_CSS = `:where(.lc-table) { overflow-x: auto; margin-block: 1em; }
:where(.lc-table table) { width: 100%; border-collapse: collapse; }
:where(.lc-table :is(th, td)) { min-width: 8em; padding: 0.5em 0.75em; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); text-align: start; vertical-align: top; }
:where(.lc-table th) { font-weight: 600; background: color-mix(in srgb, currentColor 5%, transparent); }
:where(.lc-table :is(th, td) > :first-child) { margin-top: 0; }
:where(.lc-table :is(th, td) > :last-child) { margin-bottom: 0; }`

/** Whether any text or entry holds a rich-text table. */
export function hasTable(doc: Document): boolean {
  const visit = (value: unknown): boolean =>
    typeof value === 'object' &&
    value !== null &&
    ((value as { type?: unknown }).type === 'table' || Object.values(value).some(visit))
  return visit(doc.nodes) || visit(doc.entries)
}
