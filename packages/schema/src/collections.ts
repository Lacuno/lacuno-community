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

const FieldBase = {
  id: FieldId,
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string().min(1),
  required: z.boolean().optional(),
  help: z.string().optional(),
}

/** One choice of an option field. The value is stored on entries; the label is what people see. */
export const OptionChoice = z.strictObject({
  value: z.string().min(1),
  label: z.string().min(1).optional(),
})
export type OptionChoice = z.infer<typeof OptionChoice>

/**
 * A field definition, discriminated by type so type-specific properties are required exactly
 * where they apply and rejected everywhere else. Objects are strict for the same reason: an
 * agent that sends `options` on a text field gets an error, not silent data loss.
 */
export const FieldDef = z.discriminatedUnion('type', [
  z.strictObject({
    ...FieldBase,
    type: z.literal('option'),
    options: z.array(OptionChoice).min(1),
  }),
  z.strictObject({ ...FieldBase, type: z.literal('reference'), reference: CollectionId }),
  z.strictObject({ ...FieldBase, type: z.literal('multi-reference'), reference: CollectionId }),
  z.strictObject({
    ...FieldBase,
    type: z.enum([
      'text',
      'richtext',
      'number',
      'boolean',
      'date',
      'image',
      'file',
      'color',
      'slug',
      'link',
    ]),
  }),
])
export type FieldDef = z.infer<typeof FieldDef>

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
