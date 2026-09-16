import type { DocumentStore } from '@freeflow/document'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { fail, InputError } from './errors.js'
import { catalog, GUIDE_INTRO, operationGroups } from './guide.js'
import { text } from './result.js'
import { documentJsonSchema, operationsJsonSchema } from './schemas.js'

export type ServerOptions = { siteDir?: string }

const PLACEHOLDER_TOOLS: { name: string; description: string }[] = [
  { name: 'document.read', description: 'Read the document revision and an overview.' },
  { name: 'document.apply', description: 'Apply a batch of operations to the document.' },
  { name: 'page.outline', description: "Show a page's node tree." },
  { name: 'node.get', description: 'Read one node and its subtree.' },
  { name: 'styles.get', description: 'Read the style declarations for a class.' },
  { name: 'entries.list', description: 'List entries in a collection.' },
  { name: 'asset.import', description: 'Import an asset from a path or base64 payload.' },
  { name: 'site.build', description: 'Compile the site to static output.' },
]

export function createServer(store: DocumentStore, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'freeflow', version: '0.0.0' })

  server.registerTool(
    'guide',
    {
      description: `How the Freeflow document works and the operation catalog. Groups: ${operationGroups().join(', ')}.`,
      inputSchema: { group: z.string().optional() },
    },
    async ({ group }) => {
      try {
        const body = group === undefined ? catalog() : catalog(group)
        return text(group === undefined ? `${GUIDE_INTRO}\n${body}` : body)
      } catch (e) {
        return fail(e instanceof RangeError ? new InputError(e.message) : e)
      }
    },
  )

  for (const { name, description } of PLACEHOLDER_TOOLS) {
    server.registerTool(name, { description }, async () => fail(new InputError('not implemented')))
  }

  server.registerResource(
    'document-schema',
    'freeflow://schema/document',
    { description: 'JSON Schema of the site document', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(documentJsonSchema(), null, 2),
        },
      ],
    }),
  )
  server.registerResource(
    'operations-schema',
    'freeflow://schema/operations',
    { description: 'JSON Schema of document.apply operations', mimeType: 'application/json' },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(operationsJsonSchema(), null, 2),
        },
      ],
    }),
  )

  void store
  void options
  return server
}
