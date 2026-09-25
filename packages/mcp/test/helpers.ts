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

export function textOf(result: Record<string, unknown>): string {
  const first = (result.content as { type: string; text?: string }[] | undefined)?.[0]
  return first?.text ?? ''
}

export function jsonOf<T = unknown>(result: Record<string, unknown>): T {
  return JSON.parse(textOf(result)) as T
}
