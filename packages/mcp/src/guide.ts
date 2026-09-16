import { OPERATIONS } from '@freeflow/document'
import { z } from 'zod'

export const GUIDE_INTRO = `# Freeflow document guide

A site is one JSON document. Pages point at root nodes; nodes form a tree (element, text, component instance, slot, collection-list, embed). Styling is class based: a node lists classes, and style declarations are keyed by class, breakpoint, state and property. Design tokens are named values per mode (light, dark) and compile to CSS custom properties; any style value can reference one. Components are reusable subtrees with props and slots. Collections define fields; entries hold content and live in the document for now. Assets are content-addressed files; import them with asset.import.

Workflow: call document.read for the revision and an overview, page.outline to see a tree, then document.apply with a batch of operations and the revision you read as expectedRevision. Batches are atomic and validated; a stale revision is rejected, so re-read and retry. Use dryRun to preview patches. You may supply ids (letters, digits, - and _) so later operations in the same batch can reference them; generated ids come back under created. Deleting something referenced elsewhere is refused with the referencing ids. Call site.build to produce static output.

## Rich text

Text node content is Tiptap-style JSON. Node types: \`paragraph\`, \`heading\` (attrs.level 1-6), \`blockquote\`, \`bulletList\`, \`orderedList\`, \`listItem\`, \`codeBlock\`, \`hardBreak\`, \`horizontalRule\`, \`text\`. Marks (on \`text\` nodes): \`bold\`, \`italic\`, \`code\`, \`underline\`, \`strike\`, \`link\` (attrs.href). Unknown node types render their children with a warning.

A paragraph with a bold word:
\`\`\`json
{ "type": "paragraph", "content": [{ "type": "text", "text": "hi " }, { "type": "text", "text": "there", "marks": [{ "type": "bold" }] }] }
\`\`\`

## Operations
`

export function operationGroups(): string[] {
  return [...new Set(OPERATIONS.map((o) => o.type.split('.')[0] as string))]
}

/** One line per group listing its operation names; schemas are returned per group by `catalog`. */
export function index(): string {
  const groups = operationGroups()
  const lines = groups.map((group) => {
    const names = OPERATIONS.filter((o) => o.type.startsWith(`${group}.`)).map((o) => o.type)
    return `- ${group}: ${names.join(', ')}`
  })
  return `${lines.join('\n')}\n\nCall guide with a group to get the schemas.`
}

export function catalog(group: string): string {
  const groups = operationGroups()
  if (!groups.includes(group))
    throw new RangeError(`unknown group ${group}; groups: ${groups.join(', ')}`)
  const ops = OPERATIONS.filter((o) => o.type.startsWith(`${group}.`))
  return ops
    .map(
      (o) =>
        `### ${o.type}\n\n\`\`\`json\n${JSON.stringify(z.toJSONSchema(o.schema, { unrepresentable: 'any' }), null, 2)}\n\`\`\``,
    )
    .join('\n\n')
}
