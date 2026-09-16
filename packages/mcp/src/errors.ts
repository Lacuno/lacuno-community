import { BuildError } from '@freeflow/compiler'
import { OperationError, PatchError, StaleRevisionError } from '@freeflow/document'
import { DocumentError } from '@freeflow/schema'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export type ToolError = {
  kind: 'stale' | 'operation' | 'document' | 'patch' | 'build' | 'input'
  message: string
} & Record<string, unknown>

/** Thrown by tools for bad arguments the schema cannot express (unknown page, both path and base64). */
export class InputError extends Error {}

export function describeError(e: unknown): ToolError {
  if (e instanceof StaleRevisionError)
    return { kind: 'stale', message: e.message, expected: e.expected, current: e.current }
  if (e instanceof OperationError) {
    const out: ToolError = { kind: 'operation', message: e.message, index: e.index, type: e.type }
    if (e.id !== undefined) out.id = e.id
    if (e.referencedBy !== undefined) out.referencedBy = e.referencedBy
    return out
  }
  if (e instanceof DocumentError) return { kind: 'document', message: e.message, issues: e.issues }
  if (e instanceof PatchError) return { kind: 'patch', message: e.message }
  if (e instanceof BuildError)
    return {
      kind: 'build',
      message: e.message,
      buildKind: e.kind,
      ...(e.detail ? { detail: e.detail } : {}),
    }
  if (e instanceof InputError) return { kind: 'input', message: e.message }
  return { kind: 'input', message: e instanceof Error ? e.message : String(e) }
}

export function fail(e: unknown): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(describeError(e), null, 2) }],
  }
}
