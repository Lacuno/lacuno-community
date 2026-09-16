import type { Document } from '@freeflow/schema'
import { ID_PATTERN, isReservedId, newId } from '@freeflow/schema'
import { OperationError } from './errors.js'

export type Warning = { operation: number; message: string }

/** What a planner sees: the draft as it stands, and ways to mint ids, warn and fail. */
export type PlanContext = {
  readonly doc: Document
  readonly index: number
  readonly type: string
  /** Returns a validated, unused id. A supplied id must match the id pattern and be free. */
  id(kind: string, supplied?: string): string
  warn(message: string): void
  fail(message: string, extra?: { id?: string; referencedBy?: string[] }): never
  /** Returns `value` or fails with `message`. */
  require<T>(value: T | undefined, message: string, id?: string): T
}

export function createContext(input: {
  doc: Document
  index: number
  type: string
  ids: Set<string>
  created: string[]
  warnings: Warning[]
}): PlanContext {
  const { doc, index, type, ids, created, warnings } = input
  const fail = (message: string, extra?: { id?: string; referencedBy?: string[] }): never => {
    throw new OperationError(index, type, message, extra)
  }
  return {
    doc,
    index,
    type,
    id(kind, supplied) {
      if (supplied !== undefined) {
        if (!ID_PATTERN.test(supplied) || isReservedId(supplied))
          fail(`${supplied} is not a valid id for a ${kind}`, { id: supplied })
        if (ids.has(supplied)) fail(`id ${supplied} is already in use`, { id: supplied })
        ids.add(supplied)
        created.push(supplied)
        return supplied
      }
      let id = newId()
      while (ids.has(id)) id = newId()
      ids.add(id)
      created.push(id)
      return id
    },
    warn(message) {
      warnings.push({ operation: index, message })
    },
    fail,
    require(value, message, id) {
      if (value === undefined) fail(message, id !== undefined ? { id } : undefined)
      return value as NonNullable<typeof value>
    },
  }
}
