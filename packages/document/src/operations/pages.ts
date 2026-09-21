import { CollectionId, FolderId, Page, PageId, Seo } from '@freeflow/schema'
import { z } from 'zod'
import type { PlanContext } from '../context.js'
import { defineOperation } from '../define.js'
import { partialPatches } from '../partial.js'
import type { Patch } from '../patch.js'
import { referencesToPage, subtreeIds } from '../references.js'
import { deleteSubtreePatches, materialize, NodeLiteral } from './nodes.js'

const PagePath = Page.shape.path

function checkPageRefs(
  ctx: PlanContext,
  folder?: string | null,
  collection?: string | null,
  path?: string,
): void {
  if (folder) ctx.require(ctx.doc.folders[folder], `unknown folder ${folder}`, folder)
  if (collection) {
    ctx.require(ctx.doc.collections[collection], `unknown collection ${collection}`, collection)
    if (path !== undefined && !path.includes('['))
      ctx.fail(`a collection page needs a [param] in its path, got ${path}`)
  }
}

const pageCreate = defineOperation(
  z.strictObject({
    type: z.literal('page.create'),
    id: PageId.optional(),
    name: z.string().min(1),
    path: PagePath,
    folder: FolderId.optional(),
    collection: CollectionId.optional(),
    seo: Seo.optional(),
    headCode: z.string().optional(),
    bodyCode: z.string().optional(),
    root: NodeLiteral.optional(),
  }),
  (op, ctx) => {
    ctx.unique(Object.values(ctx.doc.pages), 'path', op.path, (p) => p.path)
    checkPageRefs(ctx, op.folder, op.collection, op.path)
    const id = ctx.id('page', op.id)
    const { rootId, patches } = materialize(op.root ?? { type: 'element', tag: 'main' }, null, ctx)
    const page: Record<string, unknown> = { id, name: op.name, path: op.path, root: rootId }
    for (const key of ['folder', 'collection', 'seo', 'headCode', 'bodyCode'] as const)
      if (op[key] !== undefined) page[key] = op[key]
    return [...patches, { op: 'set', path: ['pages', id], value: page }]
  },
)

const pageUpdate = defineOperation(
  z.strictObject({
    type: z.literal('page.update'),
    id: PageId,
    name: z.string().min(1).optional(),
    path: PagePath.optional(),
    folder: FolderId.nullable().optional(),
    collection: CollectionId.nullable().optional(),
    seo: Seo.nullable().optional(),
    headCode: z.string().nullable().optional(),
    bodyCode: z.string().nullable().optional(),
  }),
  (op, ctx) => {
    const page = ctx.require(ctx.doc.pages[op.id], `unknown page ${op.id}`, op.id)
    if (op.path !== undefined)
      ctx.unique(Object.values(ctx.doc.pages), 'path', op.path, (p) => p.path, op.id)
    const collection = op.collection === undefined ? page.collection : op.collection
    checkPageRefs(ctx, op.folder, collection, op.path ?? page.path)
    const { type: _type, id: _id, ...values } = op
    return partialPatches(['pages', op.id], values, page)
  },
)

const pageDelete = defineOperation(
  z.strictObject({ type: z.literal('page.delete'), id: PageId }),
  (op, ctx) => {
    const page = ctx.require(ctx.doc.pages[op.id], `unknown page ${op.id}`, op.id)
    // Links on the page itself go with it; only links elsewhere keep it alive.
    const own = new Set(subtreeIds(ctx.doc, page.root).map((id) => `nodes.${id}`))
    const referencedBy = referencesToPage(ctx.doc, op.id).filter((ref) => !own.has(ref))
    if (referencedBy.length) ctx.fail(`page ${op.id} is referenced`, { id: op.id, referencedBy })
    return [{ op: 'delete', path: ['pages', op.id] }, ...deleteSubtreePatches(ctx.doc, page.root)]
  },
)

function folderIsInside(ctx: PlanContext, folderId: string, maybeAncestor: string): boolean {
  let current: string | undefined = folderId
  while (current) {
    if (current === maybeAncestor) return true
    current = ctx.doc.folders[current]?.parent
  }
  return false
}

const folderCreate = defineOperation(
  z.strictObject({
    type: z.literal('folder.create'),
    id: FolderId.optional(),
    name: z.string().min(1),
    parent: FolderId.optional(),
  }),
  (op, ctx) => {
    if (op.parent) ctx.require(ctx.doc.folders[op.parent], `unknown folder ${op.parent}`, op.parent)
    const id = ctx.id('folder', op.id)
    const folder = { id, name: op.name, ...(op.parent ? { parent: op.parent } : {}) }
    return [{ op: 'set', path: ['folders', id], value: folder }]
  },
)

const folderUpdate = defineOperation(
  z.strictObject({
    type: z.literal('folder.update'),
    id: FolderId,
    name: z.string().min(1).optional(),
    parent: FolderId.nullable().optional(),
  }),
  (op, ctx) => {
    const folder = ctx.require(ctx.doc.folders[op.id], `unknown folder ${op.id}`, op.id)
    if (op.parent) {
      ctx.require(ctx.doc.folders[op.parent], `unknown folder ${op.parent}`, op.parent)
      if (folderIsInside(ctx, op.parent, op.id))
        ctx.fail(`cannot move folder ${op.id} inside itself`, { id: op.id })
    }
    return partialPatches(['folders', op.id], { name: op.name, parent: op.parent }, folder)
  },
)

const folderDelete = defineOperation(
  z.strictObject({ type: z.literal('folder.delete'), id: FolderId }),
  (op, ctx) => {
    ctx.require(ctx.doc.folders[op.id], `unknown folder ${op.id}`, op.id)
    const referencedBy = [
      ...Object.values(ctx.doc.pages)
        .filter((p) => p.folder === op.id)
        .map((p) => `pages.${p.id}`),
      ...Object.values(ctx.doc.folders)
        .filter((f) => f.parent === op.id)
        .map((f) => `folders.${f.id}`),
    ].sort()
    if (referencedBy.length) ctx.fail(`folder ${op.id} is referenced`, { id: op.id, referencedBy })
    const patches: Patch[] = [{ op: 'delete', path: ['folders', op.id] }]
    return patches
  },
)

export const pageOperations = [
  pageCreate,
  pageUpdate,
  pageDelete,
  folderCreate,
  folderUpdate,
  folderDelete,
]
