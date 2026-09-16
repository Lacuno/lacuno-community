import { OPERATIONS } from '@freeflow/document'
import { z } from 'zod'

export const GUIDE_INTRO = `# Freeflow document guide

A site is one JSON document. Pages point at root nodes; nodes form a tree (element, text, component instance, slot, collection-list, embed). Styling is class based: a node lists classes, and style declarations are keyed by class, breakpoint, state and property. Design tokens are named values per mode (light, dark) and compile to CSS custom properties; any style value can reference one. Components are reusable subtrees with props and slots. Collections define fields; entries hold content and live in the document for now. Assets are content-addressed files; import them with asset.import.

Workflow: call document.read for the revision and an overview, page.outline to see a tree, then document.apply with a batch of operations and the revision you read as expectedRevision. Batches are atomic and validated; a stale revision is rejected, so re-read and retry. Use dryRun to preview patches. You may supply ids (letters, digits, - and _) so later operations in the same batch can reference them; generated ids come back under created. Deleting something referenced elsewhere is refused with the referencing ids. Call site.build to produce static output.

## Operations
`

export function operationGroups(): string[] {
  return [...new Set(OPERATIONS.map((o) => o.type.split('.')[0] as string))]
}

export function catalog(group?: string): string {
  const groups = operationGroups()
  if (group !== undefined && !groups.includes(group))
    throw new RangeError(`unknown group ${group}; groups: ${groups.join(', ')}`)
  const ops = OPERATIONS.filter((o) => group === undefined || o.type.startsWith(`${group}.`))
  return ops
    .map(
      (o) =>
        `### ${o.type}\n\n\`\`\`json\n${JSON.stringify(z.toJSONSchema(o.schema, { unrepresentable: 'any' }), null, 2)}\n\`\`\``,
    )
    .join('\n\n')
}
