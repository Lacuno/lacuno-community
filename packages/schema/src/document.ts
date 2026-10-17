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
import { Keyframes, KeyframesId } from './keyframes.js'
import { Node } from './nodes.js'
import { Folder, Page, Redirect, TitleTemplate } from './pages.js'
import { Breakpoint, Class, StyleDecl } from './styles.js'

export const DOCUMENT_VERSION = 1

const Lang = Page.shape.lang.unwrap()

/** A language the site is in. Draft languages are previewed but not published. */
export const Locale = z.strictObject({
  code: Lang,
  label: z.string().min(1).optional(),
  draft: z.boolean().optional(),
})
export type Locale = z.infer<typeof Locale>

/** One translated value, with the hash of the primary-language value it was made from. */
export const Translation = z.strictObject({ value: z.unknown(), source: z.string() })
export type Translation = z.infer<typeof Translation>

export const SiteSettings = z.object({
  name: z.string().min(1),
  locale: Lang.default('en'),
  /** The site's languages, the primary first; without them the site is in `locale` only. */
  locales: z
    .array(Locale)
    .min(1)
    .refine((all) => new Set(all.map((l) => l.code)).size === all.length, {
      message: 'each language once',
    })
    .optional(),
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
  keyframes: z.record(KeyframesId, Keyframes).default({}),
  components: z.record(ComponentId, Component).default({}),
  collections: z.record(CollectionId, CollectionSchema).default({}),
  entries: z.record(CollectionId, z.array(Entry)).default({}),
  assets: z.record(AssetId, AssetRef).default({}),
  redirects: z.array(Redirect).default([]),
  /** Per language, the translated values by translation key, see `parseKey`. */
  translations: z.record(Lang, z.record(z.string(), Translation)).default({}),
})
export type Document = z.infer<typeof Document>

/** The site's languages, the primary first. */
export const siteLocales = (doc: Document): Locale[] =>
  doc.site.locales ?? [{ code: doc.site.locale }]

export const primaryLocale = (doc: Document): string => siteLocales(doc)[0]!.code

/** The languages that are published: the primary and every one that is not a draft. */
export const publishedLocales = (doc: Document): Locale[] =>
  siteLocales(doc).filter((l, i) => i === 0 || !l.draft)

/** The page's language: its own, or else the site's. */
export const pageLang = (doc: Document, page: Page): string => page.lang ?? primaryLocale(doc)

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
