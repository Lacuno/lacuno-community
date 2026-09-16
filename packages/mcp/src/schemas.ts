import { Operation } from '@freeflow/document'
import { Document } from '@freeflow/schema'
import { z } from 'zod'

export const documentJsonSchema = () => z.toJSONSchema(Document, { unrepresentable: 'any' })
export const operationsJsonSchema = () => z.toJSONSchema(Operation, { unrepresentable: 'any' })
