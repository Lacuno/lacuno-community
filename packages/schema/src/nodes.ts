import { z } from 'zod'
import {
  AssetId,
  ClassId,
  CollectionId,
  ComponentId,
  DesignTokenId,
  FieldId,
  NodeId,
  PageId,
} from './ids.js'

/**
 * The element tree. One flat map for the whole site; pages and components point at root nodes.
 * A node's children are ordered ids. Parents are stored on the child for O(1) lookup and for
 * CRDT-friendly moves.
 */

/** Every element-bearing node carries a tag, and they all accept the same names. */
export const Tag = z.string().regex(/^[a-z][a-z0-9-]*$/, 'tag must be a lower-case html tag')

/** A value that can be static or bound to content. */
export const Binding = z.discriminatedUnion('type', [
  z.object({ type: z.literal('static'), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({
    type: z.literal('field'),
    field: FieldId,
    /** How a date field reads, in the page's language; the ISO date when left out. */
    format: z.enum(['short', 'medium', 'long', 'full']).optional(),
  }),
  z.object({ type: z.literal('designToken'), designToken: DesignTokenId }),
  z.object({ type: z.literal('asset'), asset: AssetId }),
  z.object({ type: z.literal('prop'), prop: z.string().min(1) }),
  z.object({ type: z.literal('page'), page: PageId }),
])
export type Binding = z.infer<typeof Binding>

/** Rich text stored as a Tiptap/ProseMirror JSON document. Kept opaque here. */
export const RichText = z.object({
  type: z.literal('doc'),
  content: z.array(z.record(z.string(), z.unknown())).optional(),
})
export type RichText = z.infer<typeof RichText>

/** Optional annotations that give agents and the linter a vocabulary above CSS. */
export const Semantic = z.strictObject({
  role: z.string().optional(),
  archetype: z.string().optional(),
  constraints: z
    .array(z.enum(['above-fold', 'keep-order', 'no-restyle', 'content-only']))
    .optional(),
})

export const NodeMeta = z.strictObject({
  label: z.string().optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
})

const Base = {
  id: NodeId,
  parent: NodeId.nullable(),
  children: z.array(NodeId),
  classes: z.array(ClassId),
  attrs: z.record(z.string(), Binding).optional(),
  semantic: Semantic.optional(),
  meta: NodeMeta.optional(),
}

export const ElementNode = z.object({
  ...Base,
  type: z.literal('element'),
  /** Always explicit. Lacuno never infers a tag from a component name. */
  tag: Tag,
})

/** The icons a rotating word can show before it, drawn from Lucide (see `WORD_ICONS` in css). */
export const WordIcon = z.enum([
  'sparkles',
  'bot',
  'pen-tool',
  'brush',
  'palette',
  'code',
  'smile',
  'user',
  'users',
  'hand',
  'heart',
  'star',
  'zap',
  'rocket',
  'lightbulb',
  'globe',
])
export type WordIcon = z.infer<typeof WordIcon>

/**
 * A rotating word: its text, kept as written so it may be empty or end in a space, and optionally
 * an icon before it. A plain string is a word without an icon.
 */
export const RotatingWord = z.union([
  z.string(),
  z.strictObject({ text: z.string(), icon: WordIcon.optional() }),
])
export type RotatingWord = z.infer<typeof RotatingWord>

/**
 * Words that take turns with a text's own content, in order and looping, such as a headline's
 * "AI → designer → you". The text shows first and stays the only word with reduced motion; `icon`
 * goes before it.
 */
export const RotatingWords = z.strictObject({
  words: z.array(RotatingWord).min(1).max(12),
  icon: WordIcon.optional(),
  /** Milliseconds each word shows; 2200 when left out. */
  interval: z.number().int().min(500).max(20000).optional(),
  transition: z.enum(['slide', 'fade']).optional(),
})
export type RotatingWords = z.infer<typeof RotatingWords>

export const TextNode = z.object({
  ...Base,
  type: z.literal('text'),
  tag: Tag,
  text: z.union([RichText, Binding]),
  rotatingWords: RotatingWords.optional(),
})

export const ComponentInstanceNode = z.object({
  ...Base,
  type: z.literal('component'),
  component: ComponentId,
  props: z.record(z.string(), Binding).optional(),
  /** Nodes inside the instance that override the component's own subtree. */
  overrides: z.array(NodeId).optional(),
})

export const SlotNode = z.object({
  ...Base,
  type: z.literal('slot'),
  name: z.string().min(1),
})

export const CollectionListNode = z.object({
  ...Base,
  type: z.literal('collection-list'),
  tag: Tag,
  collection: CollectionId,
  query: z
    .strictObject({
      filter: z
        .array(
          z.strictObject({
            field: FieldId,
            op: z.enum(['eq', 'ne', 'in', 'contains']),
            value: z.unknown(),
          }),
        )
        .optional(),
      sort: z
        .array(z.strictObject({ field: FieldId, direction: z.enum(['asc', 'desc']) }))
        .optional(),
      limit: z.number().int().positive().optional(),
      offset: z.number().int().nonnegative().optional(),
      /**
       * Pages of `limit` entries: the page shows the first, and `<path>/page/2` onwards the rest,
       * with previous and next links after the list. One per page, not on collection pages.
       */
      paginate: z.boolean().optional(),
    })
    .optional(),
})

export const EmbedNode = z.object({
  ...Base,
  type: z.literal('embed'),
  html: z.string(),
})

export const CodeComponentNode = z.object({
  ...Base,
  type: z.literal('code-component'),
  /** Path relative to the site's code/ directory, e.g. `Map.astro`. */
  source: z.string().min(1),
  props: z.record(z.string(), Binding).optional(),
  client: z.enum(['none', 'load', 'idle', 'visible']).optional(),
})

export const Node = z.discriminatedUnion('type', [
  ElementNode,
  TextNode,
  ComponentInstanceNode,
  SlotNode,
  CollectionListNode,
  EmbedNode,
  CodeComponentNode,
])
export type Node = z.infer<typeof Node>
export type ElementNode = z.infer<typeof ElementNode>
export type TextNode = z.infer<typeof TextNode>
export type CollectionListNode = z.infer<typeof CollectionListNode>
export type ComponentInstanceNode = z.infer<typeof ComponentInstanceNode>

/** Every binding a node carries: its attrs, a bound text value, and a component's props. */
export function nodeBindings(node: Node): Binding[] {
  return [
    ...Object.values(node.attrs ?? {}),
    ...(node.type === 'text' && node.text.type !== 'doc' ? [node.text] : []),
    ...(node.type === 'component' || node.type === 'code-component'
      ? Object.values(node.props ?? {})
      : []),
  ]
}
