import { OPERATIONS, type OperationDef } from '@lacuno/document'
import { WordIcon } from '@lacuno/schema'
import { z } from 'zod'
import { InputError } from './errors.js'

export const GUIDE_INTRO = `# Lacuno document guide

A site is one JSON document. Pages point at root nodes; nodes form a tree (element, text, component instance, slot, collection-list, embed). Styling is class based: a node lists classes, and style declarations are keyed by class, breakpoint, state and property. Design tokens are named values per mode (light, dark) and compile to CSS custom properties; any style value can reference one. The editor groups them as color, spacing, size, typography, radius and shadow and names them by group: \`color.*\`, \`space.*\`, \`size.*\`, \`font.*\`, \`radius.*\`, \`shadow.*\`. Node attributes, bound text and component props hold a binding: \`static\`, \`field\`, \`designToken\`, \`asset\`, \`prop\`, or \`page\` (\`{"type":"page","page":"<pageId>"}\`), which resolves to that page's path so a link survives a rename. Components are reusable subtrees with props and slots. Collections define fields; entries hold content and live in the document for now. Assets are content-addressed files. To add one, prefer a way that does not pass the bytes through you: asset.import with \`url\` downloads a public https address; on a connected site, asset.upload returns a single-use address for a file on your machine, which you PUT there (\`curl -sS -T photo.jpg '<url>'\`) and whose answer is the asset; asset.import with \`path\` takes a file in the site folder. asset.import with \`data\` (base64) is for tiny files only, as every byte costs tokens. A connected site takes PNG, JPEG, WebP and GIF images, MP4 and WebM videos, and WOFF2, WOFF, TTF and OTF fonts up to 10 MB. \`site.fonts\` holds one entry per font face: an \`asset\` font (an uploaded WOFF2, WOFF, TTF or OTF) or a \`system\` font, with optional \`weight\` (100 to 900) and \`style\` (\`normal\` or \`italic\`); a variable font is one face with \`weightRange\` (\`[100, 900]\`) instead of \`weight\`. A video is a \`video\` element whose \`src\` is an asset binding to a \`video/mp4\` or \`video/webm\` asset; an embed node holds raw HTML in \`html\` and publishes it as it is, inside a \`div\` carrying its classes when it has any. A page at \`/404\` is the not-found page: it builds to \`404.html\`, which static hosts serve for unknown addresses, and stays out of the sitemap like pages with \`seo.noindex\`. A page may set \`lang\` (a language tag such as \`en\` or \`de-AT\`) to override \`site.

Workflow: call document.read for the revision and an overview, page.outline to see a tree, then document.apply with a batch of operations and the revision you read as expectedRevision. Batches are atomic and validated; a stale revision is rejected, so re-read and retry. Use dryRun to preview patches. You may supply ids (letters, digits, - and _) so later operations in the same batch can reference them; generated ids come back under created. Deleting something referenced elsewhere is refused with the referencing ids. Call site.build to produce static output.

To see your work without a build: page.preview returns a route's HTML as it publishes (\`text: true\` gives one line per text node, \`nodeId<TAB>text\`, to read rather than parse); page.screenshot returns a PNG of a route at a viewport width, or of one node, and needs Playwright's Chromium; document.diff summarises what a batch of operations would change before you apply it, or what changed since another lacuno.json. The loop: read, change (check the batch with document.diff first when it is large), preview or screenshot the page, and verify before moving on.

## Rich text

Text node content is Tiptap-style JSON. Node types: \`paragraph\`, \`heading\` (attrs.level 1-6), \`blockquote\`, \`bulletList\`, \`orderedList\`, \`listItem\`, \`codeBlock\`, \`hardBreak\`, \`horizontalRule\`, \`text\`. Marks (on \`text\` nodes): \`bold\`, \`italic\`, \`code\`, \`underline\`, \`strike\`, \`link\` (attrs.href). Unknown node types render their children with a warning.

A paragraph with a bold word:
\`\`\`json
{ "type": "paragraph", "content": [{ "type": "text", "text": "hi " }, { "type": "text", "text": "there", "marks": [{ "type": "bold" }] }] }
\`\`\`

## Gradients

A gradient is a style value for \`background-image\`, not a CSS string: \`{"type":"gradient","kind":"linear","angle":135,"stops":[{"color":{"type":"color","value":"#6952d9"},"position":0},{"color":{"type":"designToken","ref":"<tokenId>"},"position":100}]}\`. \`kind\` is \`linear\` or \`radial\`; \`angle\` (degrees, 180 when left out) is for linear only; two or more stops, each a colour or colour token at a position from 0 to 100 (percent). Set it with style.set per breakpoint and state like any value. For gradient text, also set \`background-clip\` to the keyword \`text\` and \`color\` to the keyword \`transparent\` on the same class; words with their own colour mark keep that colour.

## Rotating words

A text node may set \`rotatingWords\` (node.create or node.update; \`null\` removes it): \`{"icon":"sparkles","words":[{"text":"designer","icon":"pen-tool"},"you"],"interval":2200,"transition":"slide"}\`. The node's own text shows first, then each word in turn, looping; \`interval\` is milliseconds per word (500 to 20000, 2200 when left out) and \`transition\` is \`slide\` (up, the default) or \`fade\`. A word is a string, or \`{"text","icon"}\` for an icon before it; the top-level \`icon\` goes before the node's own text. Icons (Lucide, drawn in the text colour at 0.8em): ${WordIcon.options.join(', ')}. Words are kept as written: a word may be empty, and spaces count. The element resizes to the current word, screen readers hear all words once, and with reduced motion only the first shows. Keep the node's text to one or a few words and style the node (a pill, a colour) as usual; an icon replaces a decoration such as a dot, so remove that (e.g. set \`display\` to \`none\` in the class's \`before\` state).

Texts in step: rotating texts with as many words and the same interval turn together on the page, so several can form one phrase. For "your AI, your designer, you" make "your " its own text node right before the pill, with \`{"words":["your ",""]}\` (the same word twice holds still; the empty word shrinks it away, space included), and the pill \`{"icon":"sparkles","words":[{"text":"designer","icon":"pen-tool"},{"text":"you","icon":"smile"}]}\`. Keep the texts next to each other in one parent: siblings in step are read as one phrase per turn ("your AI, your designer, you"), from the last of them. Put the spaces inside the texts, in normal text flow; a flex \`gap\` between them stays when a word empties.

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
        `### ${o.type}\n\n\`\`\`json\n${JSON.stringify(z.toJSONSchema(o.schema, { unrepresentable: 'any' }), null, 2)}\n\`\`\``,
    )
    .join('\n\n')
}
