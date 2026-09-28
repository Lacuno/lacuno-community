import { z } from 'zod'
import { AssetRef, Font } from './assets.js'
import { CollectionSchema } from './collections.js'
import { Component } from './components.js'
import { DesignToken, Mode } from './design-tokens.js'
import { Entry } from './entries.js'
import {
  AssetId,
  BreakpointId,
  ClassId,
  CollectionId,
  ComponentId,
  DesignTokenId,
  FolderId,
  NodeId,
  PageId,
} from './ids.js'
import { Node } from './nodes.js'
import { Folder, Page, Redirect, TitleTemplate } from './pages.js'
import { Breakpoint, Class, StyleDecl } from './styles.js'

export const DOCUMENT_VERSION = 1

export const SiteSettings = z.object({
  name: z.string().min(1),
  locale: Page.shape.lang.unwrap().default('en'),
  modes: z.array(Mode).min(1),
  fonts: z.array(Font).default([]),
  favicon: AssetId.optional(),
  url: z.url().optional(),
  /** Every page's title and social title, "{page} — Lacuno", unless a page sets its own. */
  titleTemplate: TitleTemplate.optional(),
  headCode: z.string().optional(),
  bodyCode: z.string().optional(),
})
export type SiteSettings = z.infer<typeof SiteSettings>

/**
 * The whole design of one site, normalized. Maps are JSON objects keyed by id so the document
 * is git-friendly and CRDT-friendly. Style keys are derived, see styleKey().
 */
export const Document = z.object({
  version: z.literal(DOCUMENT_VERSION),
  /** Bumped by the document store on every committed batch. Never set by an operation. */
  revision: z.number().int().nonnegative().default(0),
  site: SiteSettings,
  pages: z.record(PageId, Page),
  folders: z.record(FolderId, Folder).default({}),
  nodes: z.record(NodeId, Node),
  classes: z.record(ClassId, Class),
  styles: z.record(z.string(), StyleDecl),
  breakpoints: z.record(BreakpointId, Breakpoint),
  designTokens: z.record(DesignTokenId, DesignToken).default({}),
  components: z.record(ComponentId, Component).default({}),
  collections: z.record(CollectionId, CollectionSchema).default({}),
  entries: z.record(CollectionId, z.array(Entry)).default({}),
  assets: z.record(AssetId, AssetRef).default({}),
  redirects: z.array(Redirect).default([]),
})
export type Document = z.infer<typeof Document>

/** The page's language: its own, or else the site's. */
export const pageLang = (doc: Document, page: Page): string => page.lang ?? doc.site.locale

/** An entry by id, with its collection, whichever collection holds it. */
export function findEntry(
  doc: Document,
  id: string,
): { collection: CollectionSchema; entry: Entry } | undefined {
  for (const [collection, entries] of Object.entries(doc.entries)) {
    const entry = entries.find((item) => item.id === id)
    const col = doc.collections[collection]
    if (entry && col) return { collection: col, entry }
  }
}
