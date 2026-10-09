import { OPERATIONS, type OperationDef } from '@lacuno/document'
import { RichTag, WordIcon } from '@lacuno/schema'
import { z } from 'zod'
import { InputError } from './errors.js'

/**
 * What every AI app is told when it connects, before it calls anything. Short and plain on
 * purpose: hosts that never load the plugin's skills read this, and the guide's topics.
 */
export const INSTRUCTIONS = `Lacuno builds websites. A site is one JSON document. The person sees every change live in the editor.
- Call guide first. Before a task, call guide with its topic: build, check, looks, text, content, forms, menu, settings.
- Read once with document.read. Change with document.apply in few big batches. Pass the revision you read.
- Check with page.outline, page.preview (text: true) and page.screenshot. Never rebuild the site on your machine.
- The person says "this" or "here" and the editor is open in the chat: call editor.selection first.
- Build with nodes, classes and breakpoints. No scripts. No embed for anything nodes can do.
- Publish only when asked.`

export const GUIDE_INTRO = `# Lacuno guide

A site is one JSON document: pages, a tree of nodes, classes with styles, design tokens, components, collections and assets.
- Nodes: element, text, component instance, slot, collection-list, embed.
- Style through classes. A style is keyed by class, breakpoint, state and property.
- Design tokens are named values: \`color.*\`, \`space.*\`, \`size.*\`, \`font.*\`, \`radius.*\`, \`shadow.*\`. Any style value can use one.
- Attributes, bound text and props hold a binding: \`static\`, \`field\`, \`designToken\`, \`asset\`, \`prop\` or \`page\`.

Work like this:
1. document.read for the revision and an overview. page.outline for one page's tree.
2. document.apply with a batch of operations and the revision as expectedRevision. All or nothing. The answer has the new revision, created ids and warnings. Stale revision: read again, send again.
3. Check the page with page.outline, page.preview and page.screenshot: topic check.

Topics, call guide with one: build, check, looks, text, content, forms, menu, settings.
Operations by group:
`

/** How to do things, one topic each; `guide` answers a topic by name. */
export const TOPICS: Record<string, string> = {
  build: `## Build
- Plan first: tokens, then classes, then nodes.
- Few big batches: one for tokens and classes, one per page or big section. Not dozens of small ones.
- Give your own ids (letters, digits, - and _). Later operations in the same batch can use them.
- node.create takes nested children: one operation makes a whole section.
- Use the revision from each answer. Do not read the whole document again after every batch.
- Big or risky batch: try it with dryRun: true or document.diff first.
- Link to pages with a page binding, \`{"type":"page","page":"<pageId>"}\`, not a path. It survives a rename.
- Repeated things (cards, team, posts): a component or a collection list.
- Images: asset.import with a public https \`url\`, or asset.upload for a file on your machine, then PUT it: \`curl -sS -T photo.jpg '<url>'\`. base64 \`data\` only for tiny files. Images PNG, JPEG, WebP, GIF; video MP4, WebM; fonts WOFF2, WOFF, TTF, OTF; up to 10 MB.
- document.read lists \`usedBy\` for every asset. Delete only unused ones.
- Deleting anything in use is refused with the ids that use it.
- Video: a \`video\` element, \`src\` an asset binding.
- Embed: raw HTML, published as it is. Only for third-party widgets. Never for menus, layout or anything nodes can do: nobody can edit it.`,

  check: `## Check
After each big batch:
1. page.outline (a page or component, \`depth\` keeps it short): sections in place, nothing doubled or empty.
2. page.preview with text: true: one line per text, \`nodeId<TAB>text\`. Find typos, wrong order, placeholder text. Without text: the published HTML, for attributes and links.
3. page.screenshot: a JPEG of the first screen, width 1280 by default. Check 390 too. Below the first screen: pass \`node\` for a PNG of that section. fullPage cuts at 4000 px and shrinks the text unreadable.
4. styles.get with a class, classes or a \`node\`: why something looks wrong.
5. Fix everything you found in one batch. Check again.
- Collection pages: pass \`entry\` (id or slug).
- No page.screenshot here: use the outline and the text.
- Never rebuild the site on your machine, run a dev server or publish just to look.
- Tell the person what you checked and what you could not.
- page.view is for the person, not for you: it shows them the page to point at.
- editor.selection: what the person selected in the editor open in the chat. Call it before acting on "this" or "here".`,

  looks: `## Looks
- style.set: class, property, value. Leave out breakpoint and state for base and none. style.clear the same way.
- Reuse classes and tokens before making new ones.
- document.read lists the breakpoints. The base is desktop; smaller ones override it.
- States include hover, focus, focus-visible, focus-within, active, checked, disabled, first-child, last-child, before, after, placeholder.
- Tokens have a value per mode (light, dark) and become CSS variables. Use them for colours, spacing, radii and fonts.
- styles.get reads several classes, or every class in a node's subtree, in one call.
- A gradient is a value for \`background-image\`, not a CSS string:
\`{"type":"gradient","kind":"linear","angle":135,"stops":[{"color":{"type":"color","value":"#6952d9"},"position":0},{"color":{"type":"designToken","ref":"<tokenId>"},"position":100}]}\`
  kind linear or radial. angle for linear, 180 by default. Radial: \`shape\` ellipse or circle, centre \`at\` \`{"x":0-100,"y":0-100}\`. Two or more stops, position 0 to 100.
- A glow from the top: \`{"type":"gradient","kind":"radial","at":{"x":50,"y":0},"stops":[{"color":{"type":"color","value":"#ece4ff"},"position":0},{"color":{"type":"color","value":"#ffffff"},"position":75}]}\`
- Gradient text: also \`background-clip\` keyword \`text\` and \`color\` keyword \`transparent\` on the same class.
- Fonts: \`site.fonts\`, one entry per face: an \`asset\` font (an uploaded file) or a \`system\` font, \`weight\` 100 to 900, \`style\` normal or italic. A variable font is one face with \`weightRange\` \`[100, 900]\`.`,

  text: `## Text
Text content is Tiptap-style JSON.
- Nodes: paragraph, heading (attrs.level 1-6), blockquote, bulletList, orderedList, listItem, codeBlock, hardBreak, horizontalRule, table, tableRow, tableHeader, tableCell, text.
- Marks on text: bold, italic, code, underline, strike, link (attrs.href).
\`{"type":"paragraph","content":[{"type":"text","text":"hi "},{"type":"text","text":"there","marks":[{"type":"bold"}]}]}\`

Tables: table > tableRow > tableHeader or tableCell > blocks, usually one paragraph. Every row the same column count; \`attrs.colspan\` and \`attrs.rowspan\` merge cells. No nested tables. A first row of tableHeader cells is the header row. Put a table in a rich-text field or a text node tagged \`div\`, not \`p\` or a heading.
\`{"type":"table","content":[{"type":"tableRow","content":[{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"What"}]}]},{"type":"tableHeader","content":[{"type":"paragraph","content":[{"type":"text","text":"Why"}]}]}]},{"type":"tableRow","content":[{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"Email"}]}]},{"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"To sign in","marks":[{"type":"bold"}]}]}]}]}]}\`

Style tags inside rich text per class, with style.set and a \`tag\`, compiled to \`.legal a\`:
\`{"type":"style.set","class":"<classId>","tag":"a","breakpoint":"base","state":"hover","property":"text-decoration-line","value":{"type":"keyword","value":"underline"}}\`
Put the class on the text that holds the rich text. Tags: ${RichTag.options.join(', ')}. A table is \`table\`, \`th\` and \`td\`; \`min-width\` on \`td\` lets it fit a phone. styles.get lists these rules as "<class> <tag>".

Rotating words: a text node's \`rotatingWords\` (\`null\` removes it):
\`{"icon":"sparkles","words":[{"text":"designer","icon":"pen-tool"},"you"],"interval":2200,"transition":"slide"}\`
- The node's own text shows first, then each word, in a loop. interval 500 to 20000 ms. transition slide or fade.
- A word is a string or \`{"text","icon"}\`. Icons (Lucide): ${WordIcon.options.join(', ')}.
- Rotating texts with the same word count and interval turn together. For "your designer, you": "your " as its own text \`{"words":["your ",""]}\` right before the pill. Keep them siblings; put spaces inside the texts.`,

  content: `## Content
A collection has fields; entries hold the content. People edit them in the editor's CMS too, so name them clearly.
- Field types: text, slug, richtext, number, boolean, date, image, file, color, link, option, reference, multi-reference. \`slugField\` gives each entry its address; slugs are unique.
- Entry values are keyed by field id: text, slug, link and color a string; a number; true or false; a date \`2026-09-28\`; richtext a rich text document; image and file an asset id; option one of its values; reference an entry id; multi-reference a list of ids.
- Reuse a collection before making a similar one. document.read lists them with \`usedBy\`; entries.list reads entries.
- Make the collection, its fields and its entries in one batch with your own ids. Many entries: a few big batches.
- Images in entries: import them first, store the asset id.
- field.update renames without breaking bindings. field.move reorders.
- Refused: a change that breaks entries (a new required field with empty values, removing a used option). Fill the values in the same batch.
- Refused: deleting something in use (\`referencedBy\`). Remove or rebind it first, in the same batch.
Show entries:
- A \`collection-list\` node repeats its children per entry. \`query\`: filter (\`eq\`, \`ne\`, \`contains\`, \`in\` on a field id), sort, \`offset\`, \`limit\`; \`paginate: true\` with a limit makes \`<path>/page/2\` and on.
- A page with \`collection\` and \`[slug]\` in its path renders once per entry.
- Inside those, bind \`{"type":"field","field":"<fieldId>"}\`. Anywhere else, name the entry: \`{"type":"field","entry":"<entryId>","field":"<fieldId>"}\`.
- A rich text field: bind it on a text tagged \`div\`.
- Dates: \`format\` long, medium, numeric, short or full; \`locale\` optional.
- A field inside a text's own rich text: \`{"type":"field","attrs":{"field":"<fieldId>","format":"long"}}\`.
- An image \`src\` bound to an image field gets the optimised picture. An \`href\` bound to a slug links to that entry's page; a reference, to the referenced entry's page.
- Collection page: \`seo.fields\` (\`title\`, \`description\`, \`ogImage\`) name the entry's fields. Any other page: \`seo.entry\` plus \`seo.fields\`.
- node.update with \`collection\` points a list at another collection. Rebind its fields in the same batch.`,

  forms: `## Forms
A form is plain nodes. Published, each message is emailed to the workspace owner, replying to the first email the visitor typed. Nothing is stored.
One node.create with children:
- A \`form\` element, no \`action\`. \`data-lacuno-form\`: its name in the email ("Contact form" by default). \`data-success\`: the text shown after sending.
- Each field: a \`label\` element holding a text (the label) and the control: \`input\` (\`name\`, \`type\` text, email, tel, number, url, date or checkbox, \`placeholder\`, \`required\`), \`textarea\`, or \`select\` with text children tagged \`option\`.
- Every control needs a \`name\`. Add an email field so the owner can reply.
- Last: a text node tagged \`button\` with \`type\` submit.
- The canvas never sends. To test: publish, then submit on the testing address.
- A form with its own \`action\` publishes as it is and is not emailed.
- No file uploads, payments or stored messages. Say so.
- No own scripts, honeypots or spam checks: Lacuno adds them.`,

  menu: `## Menu
A mobile menu needs no script and no embed. The browser opens and closes it: click, Escape, click outside.
- A \`button\` with \`popovertarget\` set to the \`id\` of a \`nav\`. The nav has \`popover\` \`auto\` and holds the links (ul > li > a). The button has \`aria-label\` "Menu" and three \`span\` bars: height 2px, background currentColor, pointer-events none.
- Desktop (base): the button \`display: none\`. The nav shows inline: display block, position static, inset auto, margin 0, padding 0, border 0, background transparent, width auto, height auto, overflow visible. The ul is the row: display flex, gap.
- Tablet and smaller: the button \`display: inline-flex\`. The nav \`display: revert\` (the browser hides it until opened), position fixed, inset 0 0 0 auto, width min(80vw, 320px), padding, a background, a box-shadow. The ul: flex-direction column.
- The editor's palette has this as Menu.`,

  settings: `## Settings
- A page at \`/404\` is the not-found page.
- A page's \`lang\` (en, de-AT) overrides \`site.locale\`.
- \`site.titleTemplate\` like \`{page} — Acme\` shapes every title. A page's \`seo.titleTemplate\` replaces it; \`false\` keeps that page's title as it is.
- \`seo.noindex\` keeps a page out of search and the sitemap.
- site.publish only when the person asks, and only the owner may. It publishes to the testing address.
- site.build makes the static output.`,
}

/** asset.create only records an asset; the bytes come with the asset.import tool. */
export const WITHHELD_OPERATIONS: Record<string, string> = {
  'asset.create': 'use the asset.import tool, which stores the bytes',
}

/** The operations this server accepts and advertises. */
export const MCP_OPERATIONS: OperationDef[] = OPERATIONS.filter(
  (o) => !(o.type in WITHHELD_OPERATIONS),
)

export function operationGroups(): string[] {
  return [...new Set(MCP_OPERATIONS.map((o) => o.type.split('.')[0] as string))]
}

/** One line per group listing its operation names; schemas are returned per group by `catalog`. */
export function index(): string {
  const groups = operationGroups()
  const lines = groups.map((group) => {
    const names = MCP_OPERATIONS.filter((o) => o.type.startsWith(`${group}.`)).map((o) => o.type)
    return `- ${group}: ${names.join(', ')}`
  })
  return `${lines.join('\n')}\n\nCall guide with a group to get the schemas.`
}

export function catalog(group: string): string {
  const groups = operationGroups()
  if (!groups.includes(group))
    throw new InputError(
      `unknown group ${group}; topics: ${Object.keys(TOPICS).join(', ')}; groups: ${groups.join(', ')}`,
    )
  const ops = MCP_OPERATIONS.filter((o) => o.type.startsWith(`${group}.`))
  return ops
    .map(
      (o) =>
        // What a caller may send (fields with a default are optional), repeated parts once under
        // $defs, no indentation and no noise: the node group was about 75,000 characters.
        `### ${o.type}\n\n${JSON.stringify(
          z.toJSONSchema(o.schema, { unrepresentable: 'any', reused: 'ref', io: 'input' }),
          (key, value) =>
            key === '$schema' || (key === 'maximum' && value === Number.MAX_SAFE_INTEGER)
              ? undefined
              : value,
        )}`,
    )
    .join('\n\n')
}
