import { z } from 'zod'
import { type OperationDef, operationMap } from '../define.js'
import { siteOperations } from './site.js'

/** Every operation the document layer understands, in catalog order. Later groups append here. */
export const OPERATIONS: readonly OperationDef[] = [...siteOperations]

export const OPERATIONS_BY_TYPE = operationMap(OPERATIONS)

/** The union of every operation schema. Doubles as the MCP tool input. */
export const Operation = z.discriminatedUnion(
  'type',
  OPERATIONS.map((o) => o.schema) as unknown as [z.ZodObject, ...z.ZodObject[]],
)
export type Operation = z.infer<typeof Operation> & { type: string }
