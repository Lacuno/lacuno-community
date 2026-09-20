import type { Binding, Component, ComponentInstanceNode, Document, Node } from '@freeflow/schema'
import { localClassCopier } from './copyLocalClasses.js'
import { type EditOperation, type PageTree, pageTree } from './history.js'
import { insertionTarget, subtreeRestriction } from './structure.js'

export function componentUsage(doc: Document, id: string) {
  return Object.values(doc.nodes).filter(
    (node) => node.type === 'component' && node.component === id,
  ).length
}

/** Structure tools can edit this definition, while every other definition remains protected. */
export function componentEditingDocument(doc: Document, id: string) {
  if (!id) return doc
  const components = { ...doc.components }
  delete components[id]
  return { ...doc, components }
}

export function componentNameError(doc: Document, name: string, except?: string) {
  if (!name.trim()) return 'Enter a component name.'
  if (
    Object.values(doc.components).some(
      (component) =>
        component.id !== except && component.name.toLowerCase() === name.trim().toLowerCase(),
    )
  )
    return 'A component already uses this name.'
  return ''
}

export function componentTextFields(
  doc: Document,
  root: string,
): Extract<Node, { type: 'text' }>[] {
  const node = doc.nodes[root]
  if (!node || node.type === 'component') return []
  return [
    ...(node.type === 'text' && node.text.type === 'static' && typeof node.text.value === 'string'
      ? [node]
      : []),
    ...node.children.flatMap((child) => componentTextFields(doc, child)),
  ]
}

export function extractComponent(doc: Document, id: string, name: string, exposed: string[]) {
  const reason = subtreeRestriction(doc, id) || componentNameError(doc, name)
  if (reason) throw new Error(reason)
  if (doc.nodes[id]?.type === 'component') throw new Error('This is already a component.')
  const component = `cmp-${crypto.randomUUID()}`
  const instance = `n-${crypto.randomUUID()}`
  const fields = componentTextFields(doc, id).filter((node) => exposed.includes(node.id))
  const props: Component['props'] = fields.map((node, index) => ({
    name: `content${index + 1}`,
    type: 'string',
    label:
      node.meta?.label ?? String(node.text.type === 'static' ? node.text.value : '').slice(0, 48),
    default: node.text.type === 'static' ? node.text.value : '',
  }))
  const operations: EditOperation[] = [
    { type: 'component.extract', node: id, id: component, instance, name: name.trim(), props },
    ...fields.map(
      (node, index): EditOperation => ({
        type: 'node.update',
        id: node.id,
        text: { type: 'prop', prop: props[index]!.name },
      }),
    ),
  ]
  return { component, instance, operations }
}

export function componentWouldCycle(doc: Document, component: string, editing: string): boolean {
  if (!editing) return false
  const seen = new Set<string>()
  const visit = (id: string): boolean => {
    if (id === editing) return true
    if (seen.has(id)) return false
    seen.add(id)
    const walk = (nodeId: string): boolean => {
      const node = doc.nodes[nodeId]
      return (
        !!node && ((node.type === 'component' && visit(node.component)) || node.children.some(walk))
      )
    }
    return !!doc.components[id] && walk(doc.components[id]!.root)
  }
  return visit(component)
}

export function insertComponent(
  doc: Document,
  component: string,
  root: string,
  selected: string,
  editing = '',
) {
  if (!doc.components[component]) throw new Error('Component no longer exists.')
  if (componentWouldCycle(doc, component, editing))
    throw new Error('A component cannot contain itself, directly or indirectly.')
  const editable = componentEditingDocument(doc, editing)
  let target: ReturnType<typeof insertionTarget>
  try {
    target = insertionTarget(editable, root, selected, 'after')
  } catch {
    target = insertionTarget(editable, root, root, 'inside')
  }
  const id = `n-${crypto.randomUUID()}`
  const operations: EditOperation[] = [
    {
      type: 'node.create',
      ...target,
      node: { id, type: 'component', component, classes: [], children: [] },
    },
  ]
  return { id, operations }
}

/** Detach the rendered content, resolving exposed values and slots without losing local styles. */
export function detachComponent(doc: Document, id: string) {
  const reason = subtreeRestriction(doc, id)
  if (reason) throw new Error(reason)
  const instance = doc.nodes[id]
  if (instance?.type !== 'component' || !instance.parent)
    throw new Error('Select a component instance.')
  if (instance.overrides?.length)
    throw new Error('Detaching instances with subtree overrides is not supported.')
  const component = doc.components[instance.component]!
  const operations: EditOperation[] = []
  const copyClasses = localClassCopier(doc, operations)
  const values = new Map(
    component.props.map((prop) => [prop.name, instance.props?.[prop.name] ?? prop.default]),
  )
  const binding = (value: Binding): Binding => {
    if (value.type === 'field')
      throw new Error('Collection-bound instances must keep their component link.')
    if (value.type !== 'prop') return structuredClone(value)
    const resolved = values.get(value.prop)
    if (resolved && typeof resolved === 'object' && 'type' in resolved) {
      const next = resolved as Binding
      if (next.type === 'prop' || next.type === 'field')
        throw new Error('This property depends on an outer scope and cannot be detached here.')
      if (next.type === 'static' || next.type === 'asset' || next.type === 'designToken')
        return structuredClone(next)
    }
    if (resolved === undefined) return { type: 'static', value: '' }
    if (
      typeof resolved === 'string' ||
      typeof resolved === 'number' ||
      typeof resolved === 'boolean'
    )
      return { type: 'static', value: resolved }
    throw new Error('This property cannot be detached without losing its value.')
  }
  const clone = (nodeId: string, suppliedContent = false): PageTree[] => {
    const node = doc.nodes[nodeId]!
    const resolve = (value: Binding): Binding => {
      if (suppliedContent && value.type === 'prop')
        throw new Error('Slot content depends on an outer scope and cannot be detached here.')
      return binding(value)
    }
    if (node.type === 'slot') {
      const supplied = instance.children.filter((child) => {
        const slot = doc.nodes[child]!.attrs?.slot
        return (slot?.type === 'static' ? String(slot.value) : 'default') === node.name
      })
      return supplied.length
        ? supplied.flatMap((id) => clone(id, true))
        : node.children.flatMap((id) => clone(id, suppliedContent))
    }
    const tree = pageTree(doc, nodeId)
    tree.id = `n-${crypto.randomUUID()}`
    tree.classes = copyClasses(tree.classes)
    if (tree.attrs)
      tree.attrs = Object.fromEntries(
        Object.entries(tree.attrs).map(([key, value]) => [key, resolve(value)]),
      )
    if (tree.type === 'text' && tree.text.type !== 'doc') tree.text = resolve(tree.text)
    if (tree.type === 'component' && tree.props)
      tree.props = Object.fromEntries(
        Object.entries(tree.props).map(([key, value]) => [key, resolve(value)]),
      )
    tree.children = node.children.flatMap((id) => clone(id, suppliedContent))
    return [tree]
  }
  const roots = clone(component.root)
  if (roots.length !== 1) throw new Error('This component does not have a single detachable root.')
  const node = roots[0]!
  node.meta = { ...node.meta, label: component.name }
  operations.push(
    { type: 'node.delete', id },
    {
      type: 'node.create',
      parent: instance.parent,
      index: doc.nodes[instance.parent]!.children.indexOf(id),
      node,
    },
  )
  return { node, operations }
}

export type ComponentInstance = ComponentInstanceNode
