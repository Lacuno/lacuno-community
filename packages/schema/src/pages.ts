import { z } from 'zod'
import { AssetId, CollectionId, FolderId, NodeId, PageId } from './ids.js'

export const Seo = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  canonical: z.string().optional(),
  noindex: z.boolean().optional(),
  ogImage: AssetId.optional(),
})

export const Page = z.object({
  id: PageId,
  name: z.string().min(1),
  /** Route path. `/` for home, `/about`, `/blog/[slug]` for collection templates. */
  path: z.string().regex(/^\/(?:[a-z0-9-]+|\[[a-z0-9-]+\])?(?:\/(?:[a-z0-9-]+|\[[a-z0-9-]+\]))*$/),
  folder: FolderId.optional(),
  root: NodeId,
  /** A collection page renders once per entry; `path` must contain a `[param]`. */
  collection: CollectionId.optional(),
  seo: Seo.optional(),
  headCode: z.string().optional(),
  bodyCode: z.string().optional(),
})
export type Page = z.infer<typeof Page>

export const Folder = z.object({
  id: FolderId,
  name: z.string().min(1),
  parent: FolderId.optional(),
})

export const Redirect = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  status: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(301),
})
export type Redirect = z.infer<typeof Redirect>
