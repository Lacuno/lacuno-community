import type { Document } from '@miralo/schema'
import { ID_PATTERN, isReservedId, newId } from '@miralo/schema'
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
  fail(message: string, extra?: { id?: string | undefined; referencedBy?: string[] }): never
  /** Returns `value` or fails with `message`. */
  require<T>(value: T | undefined, message: string, id?: string): T
  /**
   * Fails when another record already carries `value`, e.g. a page path or a class name.
   * `except` is the id of the record being changed, which may keep its own value.
   */
  unique<T extends { id: string }>(
    records: Iterable<T>,
    label: string,
    value: unknown,
    of: (record: T) => unknown,
    except?: string,
  ): void
  /** The index of the first match, or fails with `message`. */
  indexOf<T>(items: readonly T[], match: (item: T) => boolean, message: string, id?: string): number
  /** Fails unless `index` is within 0..max. `where` names the container in the message. */
  inRange(index: number, max: number, where?: string): void
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
  const fail = (
    message: string,
    extra?: { id?: string | undefined; referencedBy?: string[] },
  ): never => {
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
      if (value === undefined) fail(message, { id })
      return value as NonNullable<typeof value>
    },
    unique(records, label, value, of, except) {
      for (const record of records)
        if (record.id !== except && of(record) === value)
          fail(`${label} ${value} is already used by ${record.id}`, { id: record.id })
    },
    indexOf(items, match, message, id) {
      const at = items.findIndex(match)
      if (at < 0) fail(message, { id })
      return at
    },
    inRange(at, max, where) {
      if (at < 0 || at > max)
        fail(`index ${at} out of range${where === undefined ? '' : ` for ${where}`} (0..${max})`)
    },
  }
}
