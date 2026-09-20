import { ComponentId, NodeId, PropDef } from '@freeflow/schema'
import { z } from 'zod'
import { defineOperation } from '../define.js'
import { partialPatches } from '../partial.js'
import { instancesOfComponent, isRootNode, parentIndex, subtreeIds } from '../references.js'
import { deleteSubtreePatches, materialize, NodeLiteral } from './nodes.js'

// Strict so a typo on a prop definition is rejected instead of silently dropped.
const StrictPropDef = PropDef.strict()

const componentCreate = defineOperation(
  z.strictObject({
    type: z.literal('component.create'),
    id: ComponentId.optional(),
    name: z.string().min(1),
    props: z.array(StrictPropDef).optional(),
    description: z.string().optional(),
    root: NodeLiteral,
  }),
  (op, ctx) => {
    const id = ctx.id('component', op.id)
    const { rootId, patches } = materialize(op.root, null, ctx)
    const component = {
      id,
      name: op.name,
      root: rootId,
      props: op.props ?? [],
      ...(op.description !== undefined ? { description: op.description } : {}),
    }
    return [...patches, { op: 'set', path: ['components', id], value: component }]
  },
)

const componentUpdate = defineOperation(
  z.strictObject({
    type: z.literal('component.update'),
    id: ComponentId,
    name: z.string().min(1).optional(),
    props: z.array(StrictPropDef).optional(),
    description: z.string().nullable().optional(),
  }),
  (op, ctx) => {
    const cmp = ctx.require(ctx.doc.components[op.id], `unknown component ${op.id}`, op.id)
    return partialPatches(
      ['components', op.id],
      { name: op.name, props: op.props, description: op.description },
      cmp as unknown as Record<string, unknown>,
    )
  },
)

const componentDelete = defineOperation(
  z.strictObject({ type: z.literal('component.delete'), id: ComponentId }),
  (op, ctx) => {
    const cmp = ctx.require(ctx.doc.components[op.id], `unknown component ${op.id}`, op.id)
    const referencedBy = instancesOfComponent(ctx.doc, op.id).map((n) => `nodes.${n}`)
    if (referencedBy.length)
      ctx.fail(`component ${op.id} is referenced`, { id: op.id, referencedBy })
    return [
      { op: 'delete', path: ['components', op.id] },
      ...deleteSubtreePatches(ctx.doc, cmp.root),
    ]
  },
)

const componentExtract = defineOperation(
  z.strictObject({
    type: z.literal('component.extract'),
    node: NodeId,
    id: ComponentId.optional(),
    instance: NodeId.optional(),
    name: z.string().min(1),
    props: z.array(StrictPropDef).optional(),
    description: z.string().optional(),
  }),
  (op, ctx) => {
    ctx.require(ctx.doc.nodes[op.node], `unknown node ${op.node}`, op.node)
    if (isRootNode(ctx.doc, op.node))
      ctx.fail(`${op.node} is a root node and cannot be extracted`, { id: op.node })
    const current = ctx.require(parentIndex(ctx.doc, op.node), `${op.node} has no parent`, op.node)
    const componentId = ctx.id('component', op.id)
    const instanceId = ctx.id('node', op.instance)
    const component = {
      id: componentId,
      name: op.name,
      root: op.node,
      props: op.props ?? [],
      ...(op.description !== undefined ? { description: op.description } : {}),
    }
    const instance = {
      id: instanceId,
      type: 'component',
      component: componentId,
      parent: current.parent,
      children: [],
      classes: [],
    }
    return [
      { op: 'set', path: ['components', componentId], value: component },
      { op: 'set', path: ['nodes', op.node, 'parent'], value: null },
      { op: 'set', path: ['nodes', instanceId], value: instance },
      { op: 'set', path: ['nodes', current.parent, 'children', current.index], value: instanceId },
    ]
  },
)

/** Exact inverse of extraction. Keep the original subtree IDs instead of deleting/recreating them. */
const componentUnextract = defineOperation(
  z.strictObject({ type: z.literal('component.unextract'), id: ComponentId, instance: NodeId }),
  (op, ctx) => {
    const component = ctx.require(ctx.doc.components[op.id], `unknown component ${op.id}`, op.id)
    const instance = ctx.require(
      ctx.doc.nodes[op.instance],
      `unknown instance ${op.instance}`,
      op.instance,
    )
    if (
      instance.type !== 'component' ||
      instance.component !== op.id ||
      instance.children.length ||
      instance.props ||
      instance.overrides ||
      instance.classes.length ||
      instance.attrs ||
      instance.meta ||
      instance.semantic
    )
      ctx.fail('Only the unchanged instance created by extraction can be unextracted', {
        id: op.instance,
      })
    const references = instancesOfComponent(ctx.doc, op.id)
    if (references.length !== 1 || references[0] !== op.instance)
      ctx.fail('Component has other instances', { id: op.id })
    for (const id of subtreeIds(ctx.doc, component.root)) {
      const node = ctx.doc.nodes[id]!
      const bindings = [
        ...Object.values(node.attrs ?? {}),
        ...(node.type === 'text' ? [node.text] : []),
        ...(node.type === 'component' ? Object.values(node.props ?? {}) : []),
      ]
      if (node.type === 'slot' || bindings.some((binding) => binding.type === 'prop'))
        ctx.fail('Restore component-scoped content before unextracting', { id })
    }
    const current = ctx.require(
      parentIndex(ctx.doc, op.instance),
      'Instance has no parent',
      op.instance,
    )
    return [
      { op: 'delete', path: ['nodes', op.instance] },
      { op: 'delete', path: ['components', op.id] },
      { op: 'set', path: ['nodes', component.root, 'parent'], value: current.parent },
      {
        op: 'set',
        path: ['nodes', current.parent, 'children', current.index],
        value: component.root,
      },
    ]
  },
)

export const componentOperations = [
  componentCreate,
  componentUpdate,
  componentDelete,
  componentExtract,
  componentUnextract,
]
