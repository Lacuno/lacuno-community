import type { Document, Node, NodeId } from '@miralo/schema'
import {
  Binding,
  ClassId,
  CollectionId,
  CollectionListNode,
  ComponentId,
  NodeId as NodeIdSchema,
  NodeMeta,
  RichText,
  Semantic,
  Tag,
} from '@miralo/schema'
import { z } from 'zod'
import type { PlanContext } from '../context.js'
import { defineOperation } from '../define.js'
import { partialPatches } from '../partial.js'
import type { Patch } from '../patch.js'
import { isDescendant, isRootNode, parentIndex, subtreeIds } from '../references.js'

const Query = CollectionListNode.shape.query.unwrap()

const literalBase = {
  id: NodeIdSchema.optional(),
  classes: z.array(ClassId).optional(),
  attrs: z.record(z.string(), Binding).optional(),
  semantic: Semantic.optional(),
  meta: NodeMeta.optional(),
}

type LiteralBase = {
  id?: string
  classes?: string[]
  attrs?: Record<string, Binding>
  semantic?: z.infer<typeof Semantic>
  meta?: z.infer<typeof NodeMeta>
  children?: NodeLiteral[]
}

/**
 * A node to create. Nested `children` literals create a whole subtree in one operation. The type
 * is written out because the schema is recursive: inferring it makes the declaration TypeScript
 * has to emit for every operation that embeds a literal too long to serialize (TS7056).
 */
export type NodeLiteral = LiteralBase &
  (
    | { type: 'element'; tag: string }
    | { type: 'text'; tag: string; text: RichText | Binding }
    | { type: 'component'; component: string; props?: Record<string, Binding> }
    | { type: 'slot'; name: string }
    | { type: 'collection-list'; tag: string; collection: string; query?: z.infer<typeof Query> }
    | { type: 'embed'; html: string }
  )

export const NodeLiteral: z.ZodType<NodeLiteral> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.strictObject({
      ...literalBase,
      type: z.literal('element'),
      tag: Tag,
      children: z.array(NodeLiteral).optional(),
    }),
    z.strictObject({
      ...literalBase,
      type: z.literal('text'),
      tag: Tag,
      text: z.union([RichText, Binding]),
      children: z.array(NodeLiteral).optional(),
    }),
    z.strictObject({
      ...literalBase,
      type: z.literal('component'),
      component: ComponentId,
      props: z.record(z.string(), Binding).optional(),
      children: z.array(NodeLiteral).optional(),
    }),
    z.strictObject({
      ...literalBase,
      type: z.literal('slot'),
      name: z.string().min(1),
      children: z.array(NodeLiteral).optional(),
    }),
    z.strictObject({
      ...literalBase,
      type: z.literal('collection-list'),
      tag: Tag,
      collection: CollectionId,
      query: Query.optional(),
      children: z.array(NodeLiteral).optional(),
    }),
    z.strictObject({
      ...literalBase,
      type: z.literal('embed'),
      html: z.string(),
      children: z.array(NodeLiteral).optional(),
    }),
  ]),
) as z.ZodType<NodeLiteral>

export function canHaveChildren(node: Node): boolean {
  return (
    node.type === 'element' ||
    node.type === 'collection-list' ||
    node.type === 'component' ||
    node.type === 'slot'
  )
}

function requireClasses(ctx: PlanContext, classes: readonly string[]): void {
  for (const c of classes) ctx.require(ctx.doc.classes[c], `unknown class ${c}`, c)
}

/** Creates the subtree described by a literal. Returns the root id and the `set` patches. */
export function materialize(
  literal: NodeLiteral,
  parent: NodeId | null,
  ctx: PlanContext,
): { rootId: NodeId; patches: Patch[] } {
  if ((literal.type === 'text' || literal.type === 'embed') && literal.children?.length)
    ctx.fail(`${literal.type} nodes cannot have children`)
  const id = ctx.id('node', literal.id)
  requireClasses(ctx, literal.classes ?? [])
  const children = (literal.children ?? []).map((c) => materialize(c, id, ctx))
  const base = {
    id,
    parent,
    children: children.map((c) => c.rootId),
    classes: literal.classes ?? [],
    ...(literal.attrs ? { attrs: literal.attrs } : {}),
    ...(literal.semantic ? { semantic: literal.semantic } : {}),
    ...(literal.meta ? { meta: literal.meta } : {}),
  }
  let node: Node
  switch (literal.type) {
    case 'element':
      node = { ...base, type: 'element', tag: literal.tag }
      break
    case 'text':
      node = { ...base, type: 'text', tag: literal.tag, text: literal.text }
      break
    case 'component':
      ctx.require(
        ctx.doc.components[literal.component],
        `unknown component ${literal.component}`,
        literal.component,
      )
      node = {
        ...base,
        type: 'component',
        component: literal.component,
        ...(literal.props ? { props: literal.props } : {}),
      }
      break
    case 'slot':
      node = { ...base, type: 'slot', name: literal.name }
      break
    case 'collection-list':
      ctx.require(
        ctx.doc.collections[literal.collection],
        `unknown collection ${literal.collection}`,
        literal.collection,
      )
      node = {
        ...base,
        type: 'collection-list',
        tag: literal.tag,
        collection: literal.collection,
        ...(literal.query ? { query: literal.query } : {}),
      }
      break
    case 'embed':
      node = { ...base, type: 'embed', html: literal.html }
      break
  }
  return {
    rootId: id,
    patches: [
      { op: 'set', path: ['nodes', id], value: node },
      ...children.flatMap((c) => c.patches),
    ],
  }
}

export function deleteSubtreePatches(doc: Document, rootId: NodeId): Patch[] {
  return subtreeIds(doc, rootId).map((id): Patch => ({ op: 'delete', path: ['nodes', id] }))
}

function requireParent(
  ctx: PlanContext,
  parentId: string,
  index: number | undefined,
): { parent: Node; index: number } {
  const parent = ctx.require(ctx.doc.nodes[parentId], `unknown node ${parentId}`, parentId)
  if (!canHaveChildren(parent))
    ctx.fail(`${parent.type} node ${parentId} cannot have children`, { id: parentId })
  const at = index ?? parent.children.length
  ctx.inRange(at, parent.children.length, parentId)
  return { parent, index: at }
}

const nodeCreate = defineOperation(
  z.strictObject({
    type: z.literal('node.create'),
    parent: NodeIdSchema,
    index: z.number().int().nonnegative().optional(),
    node: NodeLiteral,
  }),
  (op, ctx) => {
    const { index } = requireParent(ctx, op.parent, op.index)
    const { rootId, patches } = materialize(op.node, op.parent, ctx)
    return [
      ...patches,
      { op: 'insert', path: ['nodes', op.parent, 'children'], index, value: rootId },
    ]
  },
)

const nodeUpdate = defineOperation(
  z.strictObject({
    type: z.literal('node.update'),
    id: NodeIdSchema,
    classes: z.array(ClassId).optional(),
    tag: Tag.optional(),
    attrs: z.record(z.string(), Binding).nullable().optional(),
    text: z.union([RichText, Binding]).optional(),
    html: z.string().optional(),
    props: z.record(z.string(), Binding).nullable().optional(),
    query: Query.nullable().optional(),
    semantic: Semantic.nullable().optional(),
    meta: NodeMeta.nullable().optional(),
  }),
  (op, ctx) => {
    const node = ctx.require(ctx.doc.nodes[op.id], `unknown node ${op.id}`, op.id)
    if (op.tag !== undefined && !('tag' in node))
      ctx.fail('tag applies to tagged nodes only', { id: op.id })
    if (op.text !== undefined && node.type !== 'text')
      ctx.fail('text applies to text nodes only', { id: op.id })
    if (op.html !== undefined && node.type !== 'embed')
      ctx.fail('html applies to embed nodes only', { id: op.id })
    if (op.props !== undefined && node.type !== 'component')
      ctx.fail('props applies to component instances only', { id: op.id })
    if (op.query !== undefined && node.type !== 'collection-list')
      ctx.fail('query applies to collection lists only', { id: op.id })
    if (op.classes) requireClasses(ctx, op.classes)
    const { type: _type, id: _id, ...values } = op
    return partialPatches(['nodes', op.id], values, node)
  },
)

const nodeMove = defineOperation(
  z.strictObject({
    type: z.literal('node.move'),
    id: NodeIdSchema,
    parent: NodeIdSchema,
    index: z.number().int().nonnegative(),
  }),
  (op, ctx) => {
    ctx.require(ctx.doc.nodes[op.id], `unknown node ${op.id}`, op.id)
    if (isRootNode(ctx.doc, op.id))
      ctx.fail(`${op.id} is a root node and cannot be moved`, { id: op.id })
    const target = ctx.require(ctx.doc.nodes[op.parent], `unknown node ${op.parent}`, op.parent)
    if (!canHaveChildren(target))
      ctx.fail(`${target.type} node ${op.parent} cannot have children`, { id: op.parent })
    if (op.parent === op.id || isDescendant(ctx.doc, op.id, op.parent))
      ctx.fail(`cannot move ${op.id} inside its own subtree`, { id: op.id })
    const current = ctx.require(parentIndex(ctx.doc, op.id), `${op.id} has no parent`, op.id)
    if (current.parent === op.parent) {
      ctx.inRange(op.index, target.children.length - 1, op.parent)
      return current.index === op.index
        ? []
        : [
            {
              op: 'move',
              path: ['nodes', op.parent, 'children'],
              from: current.index,
              to: op.index,
            },
          ]
    }
    ctx.inRange(op.index, target.children.length, op.parent)
    return [
      { op: 'remove', path: ['nodes', current.parent, 'children'], index: current.index },
      { op: 'insert', path: ['nodes', op.parent, 'children'], index: op.index, value: op.id },
      { op: 'set', path: ['nodes', op.id, 'parent'], value: op.parent },
    ]
  },
)

const nodeDelete = defineOperation(
  z.strictObject({ type: z.literal('node.delete'), id: NodeIdSchema }),
  (op, ctx) => {
    ctx.require(ctx.doc.nodes[op.id], `unknown node ${op.id}`, op.id)
    if (isRootNode(ctx.doc, op.id))
      ctx.fail(`${op.id} is a root node; delete its page or component instead`, { id: op.id })
    const current = ctx.require(parentIndex(ctx.doc, op.id), `${op.id} has no parent`, op.id)
    return [
      { op: 'remove', path: ['nodes', current.parent, 'children'], index: current.index },
      ...deleteSubtreePatches(ctx.doc, op.id),
    ]
  },
)

export const nodeOperations = [nodeCreate, nodeUpdate, nodeMove, nodeDelete]
