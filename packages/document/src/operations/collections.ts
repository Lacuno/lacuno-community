import type { CollectionSchema, Entry, FieldDef } from '@freeflow/schema'
import { CollectionId, EntryId, FieldId, OptionChoice } from '@freeflow/schema'
import { z } from 'zod'
import type { PlanContext } from '../context.js'
import { defineOperation } from '../define.js'
import { partialPatches } from '../partial.js'
import type { Patch } from '../patch.js'
import { referencesToCollection, referencesToField } from '../references.js'

// Strict so a typo on an option choice (e.g. `lable`) is rejected instead of silently dropped.
const StrictOptionChoice = OptionChoice.strict()

// Mirrors packages/schema/src/collections.ts's FieldDef, with `id` optional: the discriminated
// union built from FieldDef.options.map((o) => o.extend({ id: FieldId.optional() })) loses its
// per-branch literal types under Zod 4 (z.infer collapses to `unknown` on type-specific
// properties), so the four strict variants are spelled out explicitly here instead, keeping the
// same runtime behavior as the brief's fallback describes.
const FieldLiteralBase = {
  id: FieldId.optional(),
  name: z.string().regex(/^[a-z][a-zA-Z0-9]*$/),
  label: z.string().min(1),
  required: z.boolean().optional(),
  help: z.string().optional(),
}

/** A field definition to create: any FieldDef variant with the id optional. */
export const FieldLiteral = z.discriminatedUnion('type', [
  z.strictObject({
    ...FieldLiteralBase,
    type: z.literal('option'),
    options: z.array(StrictOptionChoice).min(1),
  }),
  z.strictObject({ ...FieldLiteralBase, type: z.literal('reference'), reference: CollectionId }),
  z.strictObject({
    ...FieldLiteralBase,
    type: z.literal('multi-reference'),
    reference: CollectionId,
  }),
  z.strictObject({
    ...FieldLiteralBase,
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
export type FieldLiteral = z.infer<typeof FieldLiteral>

const Slug = z.string().regex(/^[a-z0-9-]+$/, 'slug must be lower-case letters, digits and dashes')

function requireCollection(ctx: PlanContext, id: string): CollectionSchema {
  return ctx.require(ctx.doc.collections[id], `unknown collection ${id}`, id)
}

function checkCollectionSlug(ctx: PlanContext, slug: string, except?: string): void {
  const clash = Object.values(ctx.doc.collections).find((c) => c.slug === slug && c.id !== except)
  if (clash) ctx.fail(`slug ${slug} is already used by ${clash.id}`, { id: clash.id })
}

function checkFieldTarget(ctx: PlanContext, field: FieldLiteral | FieldDef): void {
  if (
    (field.type === 'reference' || field.type === 'multi-reference') &&
    !ctx.doc.collections[field.reference]
  )
    ctx.fail(`unknown collection ${field.reference}`, { id: field.reference })
}

function materializeField(ctx: PlanContext, literal: FieldLiteral): FieldDef {
  const { id: supplied, ...rest } = literal as FieldLiteral & { id?: string }
  const id = ctx.id('field', supplied)
  return { ...rest, id } as FieldDef
}

const collectionCreate = defineOperation(
  z.strictObject({
    type: z.literal('collection.create'),
    id: CollectionId.optional(),
    name: z.string().min(1),
    slug: Slug,
    fields: z.array(FieldLiteral).min(1),
    /** The `name` of the field that provides entry slugs. */
    slugField: z.string().min(1),
  }),
  (op, ctx) => {
    checkCollectionSlug(ctx, op.slug)
    const names = new Set<string>()
    for (const f of op.fields) {
      if (names.has(f.name)) ctx.fail(`field name ${f.name} is used twice`)
      names.add(f.name)
      checkFieldTarget(ctx, f)
    }
    const slugLiteral = ctx.require(
      op.fields.find((f) => f.name === op.slugField),
      `no field named ${op.slugField} for slugField`,
    )
    if (slugLiteral.type !== 'slug') ctx.fail(`slug field ${op.slugField} must have type slug`)
    const id = ctx.id('collection', op.id)
    const fields = op.fields.map((f) => materializeField(ctx, f))
    const slugField = fields[op.fields.indexOf(slugLiteral)]?.id as string
    const collection = { id, name: op.name, slug: op.slug, fields, slugField }
    return [
      { op: 'set', path: ['collections', id], value: collection },
      { op: 'set', path: ['entries', id], value: [] },
    ]
  },
)

const collectionUpdate = defineOperation(
  z.strictObject({
    type: z.literal('collection.update'),
    id: CollectionId,
    name: z.string().min(1).optional(),
    slug: Slug.optional(),
  }),
  (op, ctx) => {
    requireCollection(ctx, op.id)
    if (op.slug !== undefined) checkCollectionSlug(ctx, op.slug, op.id)
    return partialPatches(['collections', op.id], { name: op.name, slug: op.slug })
  },
)

const collectionDelete = defineOperation(
  z.strictObject({ type: z.literal('collection.delete'), id: CollectionId }),
  (op, ctx) => {
    requireCollection(ctx, op.id)
    const referencedBy = referencesToCollection(ctx.doc, op.id)
    if (referencedBy.length)
      ctx.fail(`collection ${op.id} is referenced`, { id: op.id, referencedBy })
    const patches: Patch[] = [{ op: 'delete', path: ['collections', op.id] }]
    if (ctx.doc.entries[op.id]) patches.push({ op: 'delete', path: ['entries', op.id] })
    return patches
  },
)

const fieldAdd = defineOperation(
  z.strictObject({
    type: z.literal('field.add'),
    collection: CollectionId,
    field: FieldLiteral,
    index: z.number().int().nonnegative().optional(),
  }),
  (op, ctx) => {
    const col = requireCollection(ctx, op.collection)
    if (col.fields.some((f) => f.name === op.field.name))
      ctx.fail(`field name ${op.field.name} is already used`)
    checkFieldTarget(ctx, op.field)
    const index = op.index ?? col.fields.length
    if (index > col.fields.length) ctx.fail(`index ${index} out of range (0..${col.fields.length})`)
    return [
      {
        op: 'insert',
        path: ['collections', op.collection, 'fields'],
        index,
        value: materializeField(ctx, op.field),
      },
    ]
  },
)

const fieldUpdate = defineOperation(
  z.strictObject({
    type: z.literal('field.update'),
    collection: CollectionId,
    id: FieldId,
    label: z.string().min(1).optional(),
    required: z.boolean().nullable().optional(),
    help: z.string().nullable().optional(),
    options: z.array(StrictOptionChoice).min(1).optional(),
    reference: CollectionId.optional(),
  }),
  (op, ctx) => {
    const col = requireCollection(ctx, op.collection)
    const index = col.fields.findIndex((f) => f.id === op.id)
    if (index < 0) ctx.fail(`unknown field ${op.id}`, { id: op.id })
    const field = col.fields[index] as FieldDef
    if (op.options !== undefined && field.type !== 'option')
      ctx.fail('options applies to option fields only', { id: op.id })
    if (op.reference !== undefined) {
      if (field.type !== 'reference' && field.type !== 'multi-reference')
        ctx.fail('reference applies to reference fields only', { id: op.id })
      ctx.require(
        ctx.doc.collections[op.reference],
        `unknown collection ${op.reference}`,
        op.reference,
      )
    }
    return partialPatches(
      ['collections', op.collection, 'fields', index],
      {
        label: op.label,
        required: op.required,
        help: op.help,
        options: op.options,
        reference: op.reference,
      },
      field as unknown as Record<string, unknown>,
    )
  },
)

const fieldRemove = defineOperation(
  z.strictObject({ type: z.literal('field.remove'), collection: CollectionId, id: FieldId }),
  (op, ctx) => {
    const col = requireCollection(ctx, op.collection)
    const index = col.fields.findIndex((f) => f.id === op.id)
    if (index < 0) ctx.fail(`unknown field ${op.id}`, { id: op.id })
    if (col.slugField === op.id)
      ctx.fail(`${op.id} is the slug field and cannot be removed`, { id: op.id })
    const referencedBy = referencesToField(ctx.doc, op.id)
    if (referencedBy.length) ctx.fail(`field ${op.id} is referenced`, { id: op.id, referencedBy })
    const drops = (ctx.doc.entries[op.collection] ?? []).flatMap((e, i): Patch[] =>
      e.fields[op.id] !== undefined
        ? [{ op: 'delete', path: ['entries', op.collection, i, 'fields', op.id] }]
        : [],
    )
    return [...drops, { op: 'remove', path: ['collections', op.collection, 'fields'], index }]
  },
)

function checkEntryFieldKeys(
  ctx: PlanContext,
  col: CollectionSchema,
  fields: Record<string, unknown>,
): void {
  for (const key of Object.keys(fields))
    if (!col.fields.some((f) => f.id === key)) ctx.fail(`unknown field ${key}`, { id: key })
}

/** Checks one entry's field values against the collection: required, known, slug, options. */
function checkEntryFields(
  ctx: PlanContext,
  col: CollectionSchema,
  fields: Record<string, unknown>,
  except?: string,
): void {
  for (const f of col.fields) {
    const value = fields[f.id]
    if (f.required && value === undefined) ctx.fail(`missing required field ${f.name}`)
    if (f.type === 'option' && value !== undefined && !f.options.some((o) => o.value === value))
      ctx.fail(`${JSON.stringify(value)} is not an option of field ${f.name}`)
  }
  checkEntryFieldKeys(ctx, col, fields)
  const slug = fields[col.slugField]
  if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug))
    ctx.fail(`slug must be lower-case letters, digits and dashes, got ${JSON.stringify(slug)}`)
  const clash = (ctx.doc.entries[col.id] ?? []).find(
    (e) => e.id !== except && e.fields[col.slugField] === slug,
  )
  if (clash) ctx.fail(`slug ${slug} is already used by ${clash.id}`, { id: clash.id })
}

function entryIndex(
  ctx: PlanContext,
  collection: string,
  id: string,
): { entry: Entry; index: number } {
  const entries = ctx.doc.entries[collection] ?? []
  const index = entries.findIndex((e) => e.id === id)
  if (index < 0) ctx.fail(`unknown entry ${id}`, { id })
  return { entry: entries[index] as Entry, index }
}

const entryCreate = defineOperation(
  z.strictObject({
    type: z.literal('entry.create'),
    collection: CollectionId,
    id: EntryId.optional(),
    fields: z.record(FieldId, z.unknown()),
    index: z.number().int().nonnegative().optional(),
  }),
  (op, ctx) => {
    const col = requireCollection(ctx, op.collection)
    checkEntryFieldKeys(ctx, col, op.fields)
    // An explicit null on create means "no value", same as omitting the key, so a null on a
    // required field is reported as missing rather than committed as a literal null.
    const fields = Object.fromEntries(
      Object.entries(op.fields).filter(([, value]) => value !== null),
    )
    checkEntryFields(ctx, col, fields)
    const entries = ctx.doc.entries[op.collection] ?? []
    const index = op.index ?? entries.length
    if (index > entries.length) ctx.fail(`index ${index} out of range (0..${entries.length})`)
    const id = ctx.id('entry', op.id)
    const patches: Patch[] = []
    if (!ctx.doc.entries[op.collection])
      patches.push({ op: 'set', path: ['entries', op.collection], value: [] })
    patches.push({
      op: 'insert',
      path: ['entries', op.collection],
      index,
      value: { id, fields },
    })
    return patches
  },
)

const entryUpdate = defineOperation(
  z.strictObject({
    type: z.literal('entry.update'),
    collection: CollectionId,
    id: EntryId,
    fields: z.record(FieldId, z.unknown()),
  }),
  (op, ctx) => {
    const col = requireCollection(ctx, op.collection)
    const { entry, index } = entryIndex(ctx, op.collection, op.id)
    const merged: Record<string, unknown> = { ...entry.fields }
    for (const [key, value] of Object.entries(op.fields)) {
      if (value === null) delete merged[key]
      else merged[key] = value
    }
    checkEntryFields(ctx, col, merged, op.id)
    return partialPatches(['entries', op.collection, index, 'fields'], op.fields, entry.fields)
  },
)

const entryDelete = defineOperation(
  z.strictObject({ type: z.literal('entry.delete'), collection: CollectionId, id: EntryId }),
  (op, ctx) => {
    requireCollection(ctx, op.collection)
    const { index } = entryIndex(ctx, op.collection, op.id)
    return [{ op: 'remove', path: ['entries', op.collection], index }]
  },
)

const entryMove = defineOperation(
  z.strictObject({
    type: z.literal('entry.move'),
    collection: CollectionId,
    id: EntryId,
    index: z.number().int().nonnegative(),
  }),
  (op, ctx) => {
    requireCollection(ctx, op.collection)
    const { index } = entryIndex(ctx, op.collection, op.id)
    const length = ctx.doc.entries[op.collection]?.length ?? 0
    if (op.index >= length) ctx.fail(`index ${op.index} out of range (0..${length - 1})`)
    return index === op.index
      ? []
      : [{ op: 'move', path: ['entries', op.collection], from: index, to: op.index }]
  },
)

export const collectionOperations = [
  collectionCreate,
  collectionUpdate,
  collectionDelete,
  fieldAdd,
  fieldUpdate,
  fieldRemove,
  entryCreate,
  entryUpdate,
  entryDelete,
  entryMove,
]
