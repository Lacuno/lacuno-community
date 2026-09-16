import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function ok(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

export function text(s: string): CallToolResult {
  return { content: [{ type: 'text', text: s }] }
}
