import type { Operation } from '@lacuno/document'
import { ClassId, NodeId, Tag } from '@lacuno/schema'
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

/** Operations offered through another tool: asset.import stores an asset's bytes too. */
export const WITHHELD_OPERATIONS = {
  'asset.create': 'use the asset.import tool',
  // translations.apply writes one or many, against the revision translations.list gave.
  'translation.set': 'use translations.apply',
  'translation.delete': 'use translations.apply',
} as const
type Offered = Exclude<Operation['type'], keyof typeof WITHHELD_OPERATIONS>

/**
 * What each document operation's tool does, in a sentence or two, with what it refuses. Every
 * operation the server offers is here: one missing fails the typecheck.
 */
export const DESCRIPTIONS: Record<Offered, string> = {
  'site.update':
    'Changes the site\'s settings: name, primary language (locale), url, titleTemplate like "{page} — Acme", fonts (one entry per face, an asset or a system font), favicon (an asset id), and headCode and bodyCode added to every page. null clears a value.',
  'mode.create':
    'Adds a mode, such as dark, in which design tokens take other values: a label, and the CSS selector or media query that turns it on. default makes it the mode shown first.',
  'mode.update': "Changes a mode's label, selector, media query or whether it is the default.",
  'mode.delete':
    'Deletes a mode. Refused for the default or last mode, and while design tokens have values for it.',
  'redirect.add':
    'Redirects an old path (from) to a path or address (to), 301 by default, or 302, 307 or 308.',
  'redirect.remove': 'Removes the redirect from a path.',

  'node.create':
    'Adds an element, text, component instance, collection list or embed under a parent node, at index (the end by default). The node takes nested children, so one call builds a whole section; give your own ids to use them in later calls. Style through classes, not inline styles.',
  'node.update':
    "Changes a node: its classes, tag, attributes, text (rich text JSON), rotatingWords, an embed's html, an instance's props, a collection list's collection and query, label, semantic role or meta. Only the fields given change; null removes one.",
  'node.move': 'Moves a node with its children under another parent, at index.',
  'node.delete':
    'Deletes a node with its children. A page or component root cannot go; delete the page or component instead.',

  'page.create':
    'Adds a page: name, path (/about, or /blog/[slug] with collection for one page per entry), optional folder, seo, lang, headCode and bodyCode, and root, its root element (a main by default), without children: fill it with node.create.',
  'page.update':
    "Changes a page's name, path, folder, collection, seo (title, description, ogImage, noindex, titleTemplate, entry and fields), lang, headCode, bodyCode or order. Only the fields given change; null clears one.",
  'page.delete':
    'Deletes a page and its nodes. Refused while a link or anything else outside it refers to it.',
  'folder.create': 'Adds a folder that groups pages in the editor, optionally inside another.',
  'folder.update': 'Renames a folder or moves it into another (parent null for the top).',
  'folder.delete': 'Deletes a folder. Refused while pages or folders are in it.',

  'class.create':
    'Adds a class to style nodes with: a name, or local for an unnamed per-node style. preset makes a standalone named class the editor offers; combo lists classes it builds on; locked keeps people from changing it in the editor.',
  'class.update': 'Renames a class or changes its combo parents or whether it is locked.',
  'class.delete': 'Deletes a class with its styles. Refused while a node uses it.',
  'style.set':
    "Sets one CSS property of a class, as a typed value (color, length, keyword, designToken, gradient, raw and others), at a breakpoint (base by default) and state (none by default: hover, focus, before…). tag styles that tag inside the class's rich text.",
  'style.clear': 'Removes one CSS property of a class at a breakpoint, state and tag.',
  'breakpoint.create':
    'Adds a breakpoint, a width where styles change: a label and a maxWidth (smaller screens) or minWidth.',
  'breakpoint.update': "Changes a breakpoint's label or widths.",
  'breakpoint.delete': 'Deletes a breakpoint. Refused for the base and while styles are set at it.',

  'designToken.create':
    'Adds a design token, a named value styles use and the editor offers: name like color.primary, group (color, space, size, font, radius, shadow…), values by mode (one for the default mode is required), and a description.',
  'designToken.update': 'Renames a design token or changes its group or description.',
  'designToken.setValue': "Sets a design token's value in one mode.",
  'designToken.clearValue':
    "Removes a design token's value in one mode. The default mode's value cannot be cleared.",
  'designToken.delete': 'Deletes a design token. Refused while a style uses it.',
  'keyframes.create':
    'Adds custom keyframes for motion: an id (a lower-case ident, not lc-* or none) and stops, each at 0 to 100 with styles by kebab-case property. Leave out a stop to mean the element as styled.',
  'keyframes.update': 'Replaces the stops of custom keyframes.',
  'keyframes.delete': 'Deletes custom keyframes. Refused while a style names them.',

  'component.create':
    'Adds a reusable component: a name, props (text, image, link and others) instances fill in, a description, and root, its root element (a div by default), without children: fill it with node.create. To make one from nodes already on a page, use component.extract. Instances are component nodes made with node.create.',
  'component.update': "Changes a component's name, props or description.",
  'component.delete': 'Deletes a component. Refused while an instance of it is on a page.',
  'component.extract':
    'Turns an existing node and its children into a new component and puts an instance in its place: a name, and optional props and description.',
  'component.unextract':
    'Undoes component.extract: puts the nodes back in place of the instance and deletes the component. Only for the unchanged instance extraction made, while the component has no other instances.',

  'collection.create':
    'Adds a CMS collection: name, slug, fields (id, name, label, type: text, slug, richtext, number, boolean, date, image, file, color, link, option, reference or multi-reference) and slugField, the slug field that gives each entry its address.',
  'collection.update': "Changes a collection's name, slug or slugField.",
  'collection.delete':
    'Deletes a collection with its entries. Refused while a page or list uses it.',
  'field.add':
    'Adds a field to a collection, at index. A required field needs values in existing entries: add it optional, fill the entries, then make it required with field.update.',
  'field.update':
    "Changes a field's name, label, required, help, translatable, options or reference without breaking its bindings. Refused when entries would break, such as a used option removed.",
  'field.move': 'Moves a field of a collection to index.',
  'field.remove':
    'Removes a field and its values from every entry. Refused while a binding uses it.',
  'entry.create':
    'Adds an entry to a collection: its values keyed by field id (text a string, a date 2026-09-28, an image an asset id, a reference an entry id, richtext a rich text document), at index.',
  'entry.update': "Changes an entry's values by field id; the fields not given stay.",
  'entry.delete': 'Deletes an entry. Refused while a reference or binding points at it.',
  'entry.move': 'Moves an entry of a collection to index.',

  'asset.update': "Changes an asset's name, alt text or dimensions.",
  'asset.delete': 'Deletes an asset. Refused while anything uses it (document.read lists usedBy).',

  'locale.add':
    'Adds a language the site is translated into: its code (de, fr-CA), label, draft to keep it unpublished, tone formal or informal, and autoTranslate.',
  'locale.update': "Changes a translated language's label, draft, tone or autoTranslate.",
  'locale.remove': 'Removes a translated language with its translations.',
  'locale.reorder':
    "Puts the site's languages in this order of codes; the first is the primary language.",
  'glossary.set':
    'Replaces the glossary: terms with their translation per language, or none to keep a term as it is.',
}

/**
 * The tag of the root element page.create and component.create make. Their operations take a
 * whole node tree, which would repeat node.create's schema, the largest there is, in two more
 * tools; here they take only the root element, and node.create fills it.
 */
export const SHALLOW_ROOTS: Record<string, string> = {
  'page.create': 'main',
  'component.create': 'div',
}
export const ShallowRoot = z
  .strictObject({
    id: NodeId.optional(),
    tag: Tag.optional(),
    classes: z.array(ClassId).optional(),
  })
  .optional()
  .describe('The root element, without children.')

/**
 * What an operation's tool may do, from its name: deleting and removing destroy, creating and
 * adding make something new each call, the rest set a state again to the same result.
 */
export function annotationsOf(type: string): ToolAnnotations {
  const verb = type.slice(type.indexOf('.') + 1)
  return {
    readOnlyHint: false,
    destructiveHint: /^(delete|remove|clear)/.test(verb) || verb === 'unextract',
    idempotentHint: !/^(create|add|extract)$/.test(verb),
    openWorldHint: false,
  }
}
