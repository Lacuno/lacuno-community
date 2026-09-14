import { z } from 'zod'
import { ComponentId, NodeId } from './ids.js'

export const PropDef = z.object({
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  type: z.enum(['string', 'richtext', 'number', 'boolean', 'image', 'link', 'option']),
  label: z.string().optional(),
  default: z.unknown().optional(),
  options: z.array(z.string()).optional(),
})

export const Component = z.object({
  id: ComponentId,
  name: z.string().min(1),
  /** Root node of the component's subtree. Its parent is null. */
  root: NodeId,
  props: z.array(PropDef).default([]),
  description: z.string().optional(),
})
export type Component = z.infer<typeof Component>
