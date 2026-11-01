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
 * Applies operations as an AI app does, one tool call each from `revision` on, and returns the
 * last answer, or the first that is an error.
 */
export async function applyEach(
  client: Client,
  revision: number,
  operations: ({ type: string } & Record<string, unknown>)[],
) {
  let answer: Record<string, unknown> = {}
  for (const { type, ...values } of operations) {
    answer = await client.callTool({
      name: type,
      arguments: { expectedRevision: revision, ...values },
    })
    if (answer.isError) return answer
    revision = jsonOf<{ revision: number }>(answer).revision
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
