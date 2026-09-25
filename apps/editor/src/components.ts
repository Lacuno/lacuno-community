import type { Operation } from '@lacuno/document'
import { instancesOfComponent, subtreeIds } from '@lacuno/document/references'
import type { Binding, Component, Document, Node } from '@lacuno/schema'
import { localClassCopier } from './copyLocalClasses.js'
import {
  copySubtree,
  insertionTarget,
  type PageTree,
  pageTree,
  structureRestriction,
  subtreeRestriction,
} from './structure.js'

export const componentUsage = (doc: Document, id: string) => instancesOfComponent(doc, id).length

const componentNodes = (doc: Document, root: string) =>
  subtreeIds(doc, root).map((id) => doc.nodes[id]!)

export function duplicateComponent(doc: Document, id: string, name: string): Operation[] {
  const component = doc.components[id]
  if (!component) throw new Error('Component no longer exists.')
  const issue = componentNameError(doc, name)
  if (issue) throw new Error(issue)
  const operations: Operation[] = []
  const root = copySubtree(doc, component.root, operations)
  operations.push({
    type: 'component.create',
    ...structuredClone(component),
    id: `cmp-${crypto.randomUUID()}`,
    name: name.trim(),
    root,
  })
  return operations
}

export function componentDeletionReason(doc: Document, id: string): string {
  const component = doc.components[id]
  if (!component) return 'Component no longer exists.'
  const count = componentUsage(doc, id)
  if (count)
    return `Used by ${count} ${count === 1 ? 'instance' : 'instances'}. Remove or detach them before deleting this component.`
  const nodes = componentNodes(doc, component.root)
  // Undo recreates the definition from a copy, which these node kinds do not support yet.
  if (
    nodes.some(
      (node) =>
        node.type === 'code-component' || (node.type === 'component' && node.overrides?.length),
    )
  )
    return 'Components with code components or instance overrides cannot be deleted yet.'
  if (nodes.some((node) => node.meta?.locked))
    return 'Unlock this component’s content before deleting it.'
  return ''
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

/** A text node whose content is a plain string and can therefore become an instance field. */
export type StaticText = Extract<Node, { type: 'text' }> & {
  text: { type: 'static'; value: string }
}
export function componentTextFields(doc: Document, root: string): StaticText[] {
  const node = doc.nodes[root]
  if (!node || node.type === 'component') return []
  const own =
    node.type === 'text' && node.text.type === 'static' && typeof node.text.value === 'string'
      ? [node as StaticText]
      : []
  return [...own, ...node.children.flatMap((child) => componentTextFields(doc, child))]
}

/** The next free generated field name, so extraction and later additions match. */
export function fieldName(props: Component['props']) {
  let index = props.length + 1
  while (props.some((prop) => prop.name === `content${index}`)) index++
  return `content${index}`
}

export function extractComponent(doc: Document, id: string, name: string, exposed: string[]) {
  const reason = subtreeRestriction(doc, id) || componentNameError(doc, name)
  if (reason) throw new Error(reason)
  if (doc.nodes[id]?.type === 'component') throw new Error('This is already a component.')
  const component = `cmp-${crypto.randomUUID()}`
  const instance = `n-${crypto.randomUUID()}`
  const fields = componentTextFields(doc, id).filter((node) => exposed.includes(node.id))
  const props: Component['props'] = []
  for (const node of fields)
    props.push({
      name: fieldName(props),
      type: 'string',
      label: node.meta?.label ?? node.text.value.slice(0, 48),
      default: node.text.value,
    })
  const operations: Operation[] = [
    { type: 'component.extract', node: id, id: component, instance, name: name.trim(), props },
    ...fields.map(
      (node, index): Operation => ({
        type: 'node.update',
        id: node.id,
        text: { type: 'prop', prop: props[index]!.name },
      }),
    ),
  ]
  return { component, instance, operations }
}

export function fieldRemovalReason(doc: Document, component: Component, name: string): string {
  const prop = component.props.find((prop) => prop.name === name)
  if (prop?.type !== 'string' || typeof prop.default !== 'string')
    return 'Only plain-text fields with a text default can be removed here.'
  if (
    Object.values(doc.nodes).some(
      (node) =>
        node.type === 'component' &&
        node.component === component.id &&
        node.props?.[name] !== undefined,
    )
  )
    return 'Some instances have custom content for this field. Reset that content before removing it.'
  for (const node of componentNodes(doc, component.root)) {
    const bindings = [
      ...Object.values(node.attrs ?? {}),
      ...(node.type === 'component' ? Object.values(node.props ?? {}) : []),
    ]
    if (bindings.some((binding) => binding.type === 'prop' && binding.prop === name))
      return 'This field is also used by an attribute or nested component and cannot be removed here.'
    if (
      node.type === 'text' &&
      node.text.type === 'prop' &&
      node.text.prop === name &&
      structureRestriction(componentEditingDocument(doc, component.id), node.id)
    )
      return 'This field is used by protected content and cannot be removed here.'
  }
  return ''
}

export function updateComponentFields(
  doc: Document,
  component: Component,
  name: string,
  props: Component['props'],
  exposed: Record<string, string>,
): Operation[] {
  const issue = componentNameError(doc, name, component.id)
  if (issue) throw new Error(issue)
  const labels = props.map((prop) => (prop.label ?? prop.name).trim().toLowerCase())
  if (labels.some((label) => !label)) throw new Error('Every field needs a name.')
  if (new Set(labels).size !== labels.length) throw new Error('Field names must be unique.')
  const operations: Operation[] = []
  for (const prop of component.props) {
    if (props.some((next) => next.name === prop.name)) continue
    const reason = fieldRemovalReason(doc, component, prop.name)
    if (reason) throw new Error(reason)
    for (const node of componentNodes(doc, component.root)) {
      if (node.type === 'text' && node.text.type === 'prop' && node.text.prop === prop.name)
        operations.push({
          type: 'node.update',
          id: node.id,
          text: { type: 'static', value: prop.default as string },
        })
    }
  }
  const available = componentTextFields(doc, component.root)
  for (const [id, field] of Object.entries(exposed)) {
    if (!props.some((prop) => prop.name === field)) continue
    const node = available.find((node) => node.id === id)
    if (!node || structureRestriction(componentEditingDocument(doc, component.id), id))
      throw new Error('This text is no longer available to expose.')
    operations.push({ type: 'node.update', id, text: { type: 'prop', prop: field } })
  }
  operations.push({ type: 'component.update', id: component.id, name: name.trim(), props })
  return operations
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
  const operations: Operation[] = [
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
  const operations: Operation[] = []
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
