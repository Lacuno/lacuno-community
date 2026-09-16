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
import { Folder, Page, Redirect } from './pages.js'
import { Breakpoint, Class, StyleDecl } from './styles.js'

export const DOCUMENT_VERSION = 1

export const SiteSettings = z.object({
  name: z.string().min(1),
  locale: z.string().default('en'),
  modes: z.array(Mode).min(1),
  fonts: z.array(Font).default([]),
  favicon: AssetId.optional(),
  url: z.url().optional(),
  headCode: z.string().optional(),
  bodyCode: z.string().optional(),
})

/**
 * The whole design of one site, normalized. Maps are JSON objects keyed by id so the document
 * is git-friendly and CRDT-friendly. Style keys are derived, see styleKey().
 */
export const Document = z.object({
  version: z.literal(DOCUMENT_VERSION),
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
