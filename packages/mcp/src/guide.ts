import { OPERATIONS, type OperationDef } from '@lacuno/document'
import { RichTag, WordIcon } from '@lacuno/schema'
import { z } from 'zod'
import { InputError } from './errors.js'

export const GUIDE_INTRO = `# Lacuno document guide

A site is one JSON document. Pages point at root nodes; nodes form a tree (element, text, component instance, slot, collection-list, embed). Styling is class based: a node lists classes, and style declarations are keyed by class, breakpoint, state and property; style.set and style.clear take the base breakpoint and no state (\`none\`) when those are left out. styles.get reads several classes, or every class in a node's subtree, in one call. Design tokens are named values per mode (light, dark) and compile to CSS custom properties; any style value can reference one. The editor groups them as color, spacing, size, typography, radius and shadow and names them by group: \`color.*\`, \`space.*\`, \`size.*\`, \`font.*\`, \`radius.*\`, \`shadow.*\`. Node attributes, bound text and component props hold a binding: \`static\`, \`field\`, \`designToken\`, \`asset\`, \`prop\`, or \`page\` (\`{"type":"page","page":"<pageId>"}\`), which resolves to that page's path so a link survives a rename. Components are reusable subtrees with props and slots. Collections define fields; entries hold content and live in the document for now. Assets are content-addressed files. document.read lists each with \`usedBy\`, the places that reference it; to clean up, asset.delete the ones whose \`usedBy\` is empty (a used asset is refused). To add one, prefer a way that does not pass the bytes through you: asset.import with \`url\` downloads a public https address; on a connected site, asset.upload returns a single-use address for a file on your machine, which you PUT there (\`curl -sS -T photo.jpg '<url>'\`) and whose answer is the asset; asset.import with \`path\` takes a file in the site folder. asset.import with \`data\` (base64) is for tiny files only, as every byte costs tokens. A connected site takes PNG, JPEG, WebP and GIF images, MP4 and WebM videos, and WOFF2, WOFF, TTF and OTF fonts up to 10 MB. \`site.fonts\` holds one entry per font face: an \`asset\` font (an uploaded WOFF2, WOFF, TTF or OTF) or a \`system\` font, with optional \`weight\` (100 to 900) and \`style\` (\`normal\` or \`italic\`); a variable font is one face with \`weightRange\` (\`[100, 900]\`) instead of \`weight\`. A video is a \`video\` element whose \`src\` is an asset binding to a \`video/mp4\` or \`video/webm\` asset; an embed node holds raw HTML in \`html\` and publishes it as it is, inside a \`div\` carrying its classes when it has any. A page at \`/404\` is the not-found page: it builds to \`404.html\`, which static hosts serve for unknown addresses, and stays out of the sitemap like pages with \`seo.noindex\`. A page may set \`lang\` (a language tag such as \`en\` or \`de-AT\`) to override \`site.locale\` for that page. \`site.titleTemplate\` such as \`{page} — Acme\` puts every page's title and og:title into one pattern, \`{page}\` being the page's SEO title, its entry's title or its name; a page's \`seo.titleTemplate\` replaces it, and \`false\` keeps that page's title as it is.

Workflow: call document.read for the revision and an overview, page.outline to see a tree, then document.apply with a batch of operations and the revision you read as expectedRevision. Batches are atomic and validated; a stale revision is rejected, so re-read and retry. An applied batch answers with the new revision, created ids and warnings; use dryRun to preview its patches. You may supply ids (letters, digits, - and _) so later operations in the same batch can reference them; generated ids come back under created. Deleting something referenced elsewhere is refused with the referencing ids. Call site.build to produce static output.

To see your work without a build: page.preview returns a route's HTML as it publishes (\`text: true\` gives one line per text node, \`nodeId<TAB>text\`, to read rather than parse); page.screenshot returns a PNG of a route's first screen at a viewport width, or of one node (a long full page, with fullPage, reaches you too shrunk to read); document.diff summarises what a batch of operations would change before you apply it, or what changed since another lacuno.json. The loop: read, change (check the batch with document.diff first when it is large), preview or screenshot the page, and verify before moving on. Where page.screenshot is unavailable, check with page.outline and page.preview's text rather than rebuilding the page elsewhere.

## Rich text

Text node content is Tiptap-style JSON. Node types: \`paragraph\`, \`heading\` (attrs.level 1-6), \`blockquote\`, \`bulletList\`, \`orderedList\`, \`listItem\`, \`codeBlock\`, \`hardBreak\`, \`horizontalRule\`, \`table\`, \`tableRow\`, \`tableHeader\`, \`tableCell\`, \`text\`. Marks (on \`text\` nodes): \`bold\`, \`italic\`, \`code\`, \`underline\`, \`strike\`, \`link\` (attrs.href). Unknown node types render their children with a warning.

A paragraph with a bold word:
\`\`\`json
{ "type": "paragraph", "content": [{ "type": "text", "text": "hi " }, { "type": "text", "text": "there", "marks": [{ "type": "bold" }] }] }
\`\`\`

Tables: a \`table\` holds \`tableRow\`s, a row holds \`tableHeader\` or \`tableCell\` cells, and a cell holds blocks, usually one \`paragraph\` with marks as anywhere. A first row of \`tableHeader\` cells is the header row, which is optional; a \`tableHeader\` further down heads its row. Every row spans the same number of columns; a cell's \`attrs.colspan\` and \`attrs.rowspan\` merge cells. Tables do not nest, and a malformed one is refused. A table publishes as \`<table>\` with \`<thead>\` and \`<th scope>\` in a region that scrolls sideways on narrow screens, with borders and padding the site's styles can override. Put one in a rich-text entry field, or in a text node whose tag holds blocks (\`div\`, not \`p\` or a heading). A table with a header row:
\`\`\`json
{ "type": "table", "content": [
  { "type": "tableRow", "content": [
    { "type": "tableHeader", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "What" }] }] },
    { "type": "tableHeader", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Why" }] }] }] },
  { "type": "tableRow", "content": [
    { "type": "tableCell", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Email" }] }] },
    { "type": "tableCell", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "To sign in", "marks": [{ "type": "bold" }] }] }] }] }] }
\`\`\`

Rich text renders plain tags, styled per class rather than per element: style.set with a \`tag\` sets the rule for that tag inside every element carrying the class, compiled to \`.legal h2\`, per breakpoint and state like any declaration: \`{"type":"style.set","class":"<classId>","tag":"a","breakpoint":"base","state":"hover","property":"text-decoration-line","value":{"type":"keyword","value":"underline"}}\`. Put the class on the text that holds the rich text, a bound rich-text field or a text node's own blocks, and every block with that class follows. Tags: ${RichTag.options.join(', ')}. The table is \`table\`, its header cells \`th\` and other cells \`td\`; their built-in borders, padding and 8em minimum width lose to these rules, so \`min-width\` on \`td\` lets a table fit a phone. style.clear takes the same \`tag\`, and styles.get lists these rules under "<class> <tag>".

## Collections

A collection holds entries that share fields; people edit them in the editor's CMS and you edit them with the \`collection\`, \`field\` and \`entry\` operations. Entries are keyed by field id and each value has its field type's shape: \`text\`, \`slug\`, \`link\` and \`color\` a string, \`number\` a number, \`boolean\` true or false, \`date\` an ISO date (\`2026-09-28\`), \`richtext\` a rich text document, \`image\` and \`file\` an asset id, \`option\` one of its option values, \`reference\` an entry id of the target collection and \`multi-reference\` a list of them. The slug field (\`slugField\`) gives each entry its address; slugs are unique within the collection. entries.list reads entries. field.update renames (\`name\`) and relabels without touching bindings, which point at the field id; field.move reorders. Changes existing entries would break are refused: a required field while an entry has no value, an option some entry uses, a reference target. Deleting a collection, field or entry that is used is refused with \`referencedBy\`: pages and lists showing a collection, bindings and list filters on a field, entries referencing an entry, bindings and \`seo.entry\` naming an entry. document.read lists each collection's \`usedBy\` and entries.list each entry's. An asset an entry uses cannot be deleted either.

To show entries, a \`collection-list\` node repeats its children once per entry; its \`query\` filters (\`eq\`, \`ne\`, \`contains\`, \`in\` on a field id), sorts, skips (\`offset\`) and limits, and \`paginate: true\` with a \`limit\` builds the page and \`<path>/page/2\` onwards with previous and next links after the list (one per page, not on collection pages). A page with \`collection\` and a \`[slug]\` in its path renders once per entry. Inside a list, or on a collection page, a text's \`text\` or an attribute can be a field binding \`{"type":"field","field":"<fieldId>"}\` that reads the entry around it; elsewhere that is refused. On any page, a binding that names an entry by id reads that one entry: \`{"type":"field","entry":"<entryId>","field":"<fieldId>"}\`, for a page such as /privacy whose text lives in a \`Legal\` collection. Bind a rich text field on a \`div\` text: it renders its headings, lists and links as blocks. A page that is not a collection page may set \`seo.entry\` to an entry id, and its \`seo.fields\` then read that entry. A date binding may add \`format\`: \`long\` (28 September 2026), \`medium\` (Sep 28, 2026), \`numeric\` (28.09.2026), or \`short\` and \`full\`, read in the page's language unless \`locale\` names another (\`de-AT\`); without a format it reads as stored (2026-09-28). A field can also sit inside a text node's own rich text as an inline node, \`{"type":"field","attrs":{"field":"<fieldId>","format":"long"}}\` in "Last updated: …", with the same \`entry\`, \`format\` and \`locale\` and the same rule about the entry around it; marks on it apply, and a field shown this way cannot be removed; an image \`src\` bound to an image field gets the optimised picture; on \`href\`, a slug field links to the entry's own page and a reference field to the referenced entry's page. A collection page's \`seo.fields\` (\`title\`, \`description\`, \`ogImage\`) names the entry fields for its title, description and social image. node.update with \`collection\` points a list at another collection; rebind the fields inside it in the same batch.

## Gradients

A gradient is a style value for \`background-image\`, not a CSS string: \`{"type":"gradient","kind":"linear","angle":135,"stops":[{"color":{"type":"color","value":"#6952d9"},"position":0},{"color":{"type":"designToken","ref":"<tokenId>"},"position":100}]}\`. \`kind\` is \`linear\` or \`radial\`; \`angle\` (degrees, 180 when left out) is for linear only; a radial gradient may set \`shape\` (\`ellipse\`, the default, or \`circle\`) and its centre \`at\` as \`{"x":0-100,"y":0-100}\` percent of the box (50/50 when left out), so a glow from the top is \`{"type":"gradient","kind":"radial","at":{"x":50,"y":0},"stops":[{"color":{"type":"color","value":"#ece4ff"},"position":0},{"color":{"type":"color","value":"#ffffff"},"position":75}]}\`; two or more stops, each a colour or colour token at a position from 0 to 100 (percent). Set it with style.set per breakpoint and state like any value. For gradient text, also set \`background-clip\` to the keyword \`text\` and \`color\` to the keyword \`transparent\` on the same class; words with their own colour mark keep that colour.

## Rotating words

A text node may set \`rotatingWords\` (node.create or node.update; \`null\` removes it): \`{"icon":"sparkles","words":[{"text":"designer","icon":"pen-tool"},"you"],"interval":2200,"transition":"slide"}\`. The node's own text shows first, then each word in turn, looping; \`interval\` is milliseconds per word (500 to 20000, 2200 when left out) and \`transition\` is \`slide\` (up, the default) or \`fade\`. A word is a string, or \`{"text","icon"}\` for an icon before it; the top-level \`icon\` goes before the node's own text. Icons (Lucide, drawn in the text colour at 0.8em): ${WordIcon.options.join(', ')}. Words are kept as written: a word may be empty, and spaces count. The element resizes to the current word, screen readers hear all words once, and with reduced motion only the first shows. Keep the node's text to one or a few words and style the node (a pill, a colour) as usual; an icon replaces a decoration such as a dot, so remove that (e.g. set \`display\` to \`none\` in the class's \`before\` state).

Texts in step: rotating texts with as many words and the same interval turn together on the page, so several can form one phrase. For "your AI, your designer, you" make "your " its own text node right before the pill, with \`{"words":["your ",""]}\` (the same word twice holds still; the empty word shrinks it away, space included), and the pill \`{"icon":"sparkles","words":[{"text":"designer","icon":"pen-tool"},{"text":"you","icon":"smile"}]}\`. Keep the texts next to each other in one parent: siblings in step are read as one phrase per turn ("your AI, your designer, you"), from the last of them. Put the spaces inside the texts, in normal text flow; a flex \`gap\` between them stays when a word empties.

## Forms

A contact form is plain nodes: a \`form\` element without an \`action\` attribute, with \`data-lacuno-form\` (its name in the email, "Contact form" when left out) and \`data-success\` (the message that replaces the form once sent). Inside it, each field is a \`label\` element holding a text with the label and the control: an \`input\` (attrs \`name\`, \`type\` such as \`text\`, \`email\`, \`tel\`, \`number\`, \`url\`, \`date\` or \`checkbox\`, \`placeholder\`, \`required\`), a \`textarea\`, or a \`select\` whose children are text nodes with the tag \`option\`; give every control a \`name\`, which labels its value in the email. End with a \`button\` (a text node with that tag) with \`type\` \`submit\`. Published, each message is emailed to the workspace owner, replying to the first email address the visitor entered, and nothing is stored; the canvas shows the form but never sends it. A \`form\` with its own \`action\` (a newsletter provider's, say) publishes as it is.

## Operations
`

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
    throw new InputError(`unknown group ${group}; groups: ${groups.join(', ')}`)
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
