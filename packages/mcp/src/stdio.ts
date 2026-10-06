import { openFolder } from '@lacuno/document/folder'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { localScreenshot } from './screenshot.js'
import { createServer } from './server.js'

/**
 * Opens the site folder and serves MCP on stdin/stdout until the client disconnects.
 *
 * `transport` is injectable for tests; it defaults to a real `StdioServerTransport`.
 */
export async function serveStdio(siteDir: string, transport?: Transport): Promise<void> {
  const input = transport ? undefined : process.stdin
  const connection = transport ?? new StdioServerTransport()
  const store = await openFolder(siteDir)
  const screenshot = localScreenshot()
  const server = createServer(store, { siteDir, ...(screenshot && { screenshot }) })
  await server.connect(connection)
  const prevClose = connection.onclose
  const prevError = connection.onerror
  let onEnd: (() => void) | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      connection.onclose = () => {
        prevClose?.()
        resolve()
      }
      connection.onerror = (error) => {
        prevError?.(error)
        reject(error)
      }
      // The SDK listens for data/errors, but does not close its transport when stdin reaches EOF.
      onEnd = () => {
        void connection.close().catch(reject)
      }
      input?.once('end', onEnd)
      if (input?.readableEnded) onEnd()
    })
  } finally {
    if (onEnd) input?.off('end', onEnd)
    await server.close()
  }
}
