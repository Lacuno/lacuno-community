import type { z } from 'zod'
import type { PlanContext } from './context.js'
import type { Patch } from './patch.js'

export type OperationDef<S extends z.ZodType = z.ZodType> = {
  type: string
  schema: S
  plan: (op: z.output<S>, ctx: PlanContext) => Patch[]
}

type WithType = z.ZodObject<{ type: z.ZodLiteral<string> } & z.ZodRawShape>

/** Pairs an operation schema with its planner. The operation name is the schema's `type` literal. */
export function defineOperation<S extends WithType>(
  schema: S,
  plan: (op: z.output<S>, ctx: PlanContext) => Patch[],
): OperationDef<S> {
  const literal = schema.shape.type as z.ZodLiteral<string>
  const type = literal.value
  return { type, schema, plan }
}

export function operationMap(defs: readonly OperationDef[]): ReadonlyMap<string, OperationDef> {
  return new Map(defs.map((d) => [d.type, d]))
}
