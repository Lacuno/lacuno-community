import { DocumentStore } from '@freeflow/document'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

/** Opens the site folder and serves MCP on stdin/stdout until the client disconnects. */
export async function serveStdio(siteDir: string): Promise<void> {
  const store = await DocumentStore.open(siteDir)
  const server = createServer(store, { siteDir })
  const transport = new StdioServerTransport()
  await server.connect(transport)
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve()
  })
}
