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
    extra: { id?: string; referencedBy?: string[] } = {},
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

/** The file on disk has a lower revision than this process has already seen for that site. */
export class RevisionRewoundError extends Error {
  constructor(
    public seen: number,
    public found: number,
  ) {
    super(`revision went backwards: this process saw ${seen}, the file says ${found}`)
    this.name = 'RevisionRewoundError'
  }
}
