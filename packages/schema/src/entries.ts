import { z } from 'zod'
import { EntryId, FieldId } from './ids.js'

/**
 * One entry of a collection. Field values are keyed by field id and typed by the collection's
 * field definitions, which the schema cannot see here, so values are unknown and checked by
 * checkReferences(). Entries live in the document until Phase 2 moves them to storage.
 */
export const Entry = z.object({
  id: EntryId,
  fields: z.record(FieldId, z.unknown()),
})
export type Entry = z.infer<typeof Entry>
