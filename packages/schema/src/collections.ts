import { z } from 'zod'
import { CollectionId, FieldId } from './ids.js'

export const FieldType = z.enum([
  'text',
  'richtext',
  'number',
  'boolean',
  'date',
  'image',
  'file',
  'color',
  'option',
  'reference',
  'multi-reference',
  'slug',
  'link',
])

export const FieldDef = z.object({
  id: FieldId,
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string().min(1),
  type: FieldType,
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  reference: CollectionId.optional(),
  help: z.string().optional(),
})

/** The schema of a collection lives in the design document. Entries live in the database. */
export const CollectionSchema = z.object({
  id: CollectionId,
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  fields: z.array(FieldDef),
  /** Field used to build `[slug]` routes. */
  slugField: FieldId,
})
export type CollectionSchema = z.infer<typeof CollectionSchema>
