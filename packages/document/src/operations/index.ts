import { z } from 'zod'
import type { OperationDef } from '../define.js'
import { assetOperations } from './assets.js'
import { collectionOperations } from './collections.js'
import { componentOperations } from './components.js'
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
  ...componentOperations,
  ...collectionOperations,
  ...assetOperations,
]

export const OPERATIONS_BY_TYPE: ReadonlyMap<string, OperationDef> = new Map(
  OPERATIONS.map((o) => [o.type, o as OperationDef]),
)

/** The union of every operation schema. Doubles as the MCP tool input. */
export const Operation = z.discriminatedUnion(
  'type',
  OPERATIONS.map((o) => o.schema) as unknown as [z.ZodObject, ...z.ZodObject[]],
)
export type Operation = z.infer<(typeof OPERATIONS)[number]['schema']>
