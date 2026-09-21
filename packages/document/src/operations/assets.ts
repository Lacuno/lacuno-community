import { AssetId, AssetRef } from '@freeflow/schema'
import { z } from 'zod'
import { defineOperation } from '../define.js'
import { partialPatches } from '../partial.js'
import { referencesToAsset } from '../references.js'

const assetCreate = defineOperation(
  z.strictObject({
    type: z.literal('asset.create'),
    id: AssetId.optional(),
    name: AssetRef.shape.name,
    kind: AssetRef.shape.kind,
    hash: AssetRef.shape.hash,
    mime: AssetRef.shape.mime,
    size: AssetRef.shape.size,
    width: AssetRef.shape.width,
    height: AssetRef.shape.height,
    alt: AssetRef.shape.alt,
  }),
  (op, ctx) => {
    const duplicate = Object.values(ctx.doc.assets).find((a) => a.hash === op.hash)
    if (duplicate) ctx.warn(`an asset with the same hash already exists: ${duplicate.id}`)
    const id = ctx.id('asset', op.id)
    const { type: _type, id: _id, ...rest } = op
    const asset: Record<string, unknown> = { id }
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) asset[k] = v
    return [{ op: 'set', path: ['assets', id], value: asset }]
  },
)

const assetUpdate = defineOperation(
  z.strictObject({
    type: z.literal('asset.update'),
    id: AssetId,
    name: AssetRef.shape.name.optional(),
    alt: z.string().nullable().optional(),
  }),
  (op, ctx) => {
    const asset = ctx.require(ctx.doc.assets[op.id], `unknown asset ${op.id}`, op.id)
    return partialPatches(['assets', op.id], { name: op.name, alt: op.alt }, asset)
  },
)

const assetDelete = defineOperation(
  z.strictObject({ type: z.literal('asset.delete'), id: AssetId }),
  (op, ctx) => {
    ctx.require(ctx.doc.assets[op.id], `unknown asset ${op.id}`, op.id)
    const referencedBy = referencesToAsset(ctx.doc, op.id)
    if (referencedBy.length) ctx.fail(`asset ${op.id} is referenced`, { id: op.id, referencedBy })
    return [{ op: 'delete', path: ['assets', op.id] }]
  },
)

export const assetOperations = [assetCreate, assetUpdate, assetDelete]
