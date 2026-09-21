import { Document } from '@freeflow/schema'
import { z } from 'zod'
import { MCP_OPERATIONS } from './guide.js'

export const documentJsonSchema = () => z.toJSONSchema(Document, { unrepresentable: 'any' })
export const operationsJsonSchema = () =>
  z.toJSONSchema(
    z.discriminatedUnion(
      'type',
      MCP_OPERATIONS.map((o) => o.schema) as unknown as [z.ZodObject, ...z.ZodObject[]],
    ),
    { unrepresentable: 'any' },
  )
