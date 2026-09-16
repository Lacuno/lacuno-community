import { DocumentStore } from '@freeflow/document'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { createServer } from './server.js'

/**
 * Opens the site folder and serves MCP on stdin/stdout until the client disconnects.
 *
 * `transport` is injectable for tests; it defaults to a real `StdioServerTransport`.
 */
export async function serveStdio(
  siteDir: string,
  transport: Transport = new StdioServerTransport(),
): Promise<void> {
  const store = await DocumentStore.open(siteDir)
  const server = createServer(store, { siteDir })
  await server.connect(transport)
  const prevClose = transport.onclose
  const prevError = transport.onerror
  await new Promise<void>((resolve, reject) => {
    transport.onclose = () => {
      prevClose?.()
      resolve()
    }
    transport.onerror = (e) => {
      prevError?.(e)
      reject(e)
    }
  })
}
