import { BuildError } from '@lacuno/compiler'
import { OperationError, PatchError, StaleRevisionError } from '@lacuno/document'
import { DocumentError } from '@lacuno/schema'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export type ToolError = {
  kind: 'stale' | 'operation' | 'document' | 'patch' | 'build' | 'input' | 'unexpected'
  message: string
} & Record<string, unknown>

export type ToolIssue = { path: string; message: string }

/** Thrown by tools for bad arguments the schema cannot express (unknown page, both path and data). */
export class InputError extends Error {
  issues?: ToolIssue[]

  constructor(message: string, issues?: ToolIssue[]) {
    super(message)
    if (issues !== undefined) this.issues = issues
  }
}

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
  if (e instanceof InputError)
    return {
      kind: 'input',
      message: e.message,
      ...(e.issues !== undefined ? { issues: e.issues } : {}),
    }
  return {
    kind: 'unexpected',
    message: e instanceof Error ? e.message : String(e),
    ...(e instanceof Error && e.stack !== undefined ? { stack: e.stack } : {}),
  }
}

export function fail(e: unknown): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(describeError(e)) }],
  }
}
