import type { DocumentStore } from '@lacuno/document'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createServer, type ServerOptions } from '../src/index.js'

export async function connect(store: DocumentStore, options: ServerOptions = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createServer(store, options)
  await server.connect(serverTransport)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(clientTransport)
  return {
    client,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

/**
 * Applies operations as an AI app does, from `revision` on: consecutive changes of one kind in one
 * call of their tool. Returns the last answer, or the first that is an error.
 */
export async function applyChanges(
  client: Client,
  revision: number,
  operations: ({ type: string } & Record<string, unknown>)[],
) {
  let answer: Record<string, unknown> = {}
  for (let start = 0; start < operations.length; ) {
    const name = operations[start]!.type
    let end = start
    while (operations[end]?.type === name) end++
    const changes = operations.slice(start, end).map(({ type: _, ...change }) => change)
    answer = await client.callTool({ name, arguments: { expectedRevision: revision, changes } })
    if (answer.isError) return answer
    revision = jsonOf<{ revision: number }>(answer).revision
    start = end
  }
  return answer
}

export function textOf(result: Record<string, unknown>): string {
  const first = (result.content as { type: string; text?: string }[] | undefined)?.[0]
  return first?.text ?? ''
}

export function jsonOf<T = unknown>(result: Record<string, unknown>): T {
  return JSON.parse(textOf(result)) as T
}
