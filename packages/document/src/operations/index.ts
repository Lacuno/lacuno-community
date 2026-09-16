import { z } from 'zod'
import { type OperationDef, operationMap } from '../define.js'
import { designTokenOperations } from './design-tokens.js'
import { nodeOperations } from './nodes.js'
import { pageOperations } from './pages.js'
import { siteOperations } from './site.js'
import { styleOperations } from './styles.js'

/** Every operation the document layer understands, in catalog order. Later groups append here. */
export const OPERATIONS = [
  ...siteOperations,
  ...nodeOperations,
  ...pageOperations,
  ...styleOperations,
  ...designTokenOperations,
]

export const OPERATIONS_BY_TYPE = operationMap(OPERATIONS as readonly OperationDef[])

/** The union of every operation schema. Doubles as the MCP tool input. */
export const Operation = z.discriminatedUnion(
  'type',
  OPERATIONS.map((o) => o.schema) as unknown as [z.ZodObject, ...z.ZodObject[]],
)
export type Operation = z.infer<(typeof OPERATIONS)[number]['schema']>
