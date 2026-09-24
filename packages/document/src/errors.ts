import { DocumentError } from '@freeflow/schema'
import type { Patch } from './patch.js'

/** The batch named a revision that is no longer current. Re-read and retry. */
export class StaleRevisionError extends Error {
  constructor(
    public expected: number,
    public current: number,
  ) {
    super(`stale revision: batch expected ${expected}, document is at ${current}`)
    this.name = 'StaleRevisionError'
  }
}

/** A planner precondition failed. Nothing was applied. */
export class OperationError extends Error {
  public id?: string
  public referencedBy?: string[]
  constructor(
    public index: number,
    public type: string,
    message: string,
    extra: { id?: string | undefined; referencedBy?: string[] } = {},
  ) {
    super(`operation ${index} (${type}): ${message}`)
    this.name = 'OperationError'
    if (extra.id !== undefined) this.id = extra.id
    if (extra.referencedBy !== undefined) this.referencedBy = extra.referencedBy
  }
}

/** The applier could not execute a patch. This indicates a planner bug. */
export class PatchError extends Error {
  constructor(
    message: string,
    public patch: Patch,
  ) {
    super(`invalid patch (planner bug): ${message}`)
    this.name = 'PatchError'
  }
}

/** The status and body an API answers a rejected batch with, or undefined for any other error. */
export function documentErrorResponse(
  error: unknown,
): { status: 400 | 409; body: { error: string; currentRevision?: number } } | undefined {
  if (error instanceof StaleRevisionError)
    return { status: 409, body: { error: error.message, currentRevision: error.current } }
  if (
    error instanceof OperationError ||
    error instanceof DocumentError ||
    error instanceof PatchError
  )
    return { status: 400, body: { error: error.message } }
}
