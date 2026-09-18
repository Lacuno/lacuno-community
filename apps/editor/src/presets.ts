import { classNames, selectorFor } from '@freeflow/css'
import type { CssValue, Document, Node } from '@freeflow/schema'
import { formattingGroups, formattingOperations, localClass } from './formatting.js'
import type { EditOperation } from './history.js'

const properties = new Set<string>(
  formattingGroups.flatMap((group) => group.fields.map((field) => field.property)),
)

export function activePreset(doc: Document, node: Node) {
  return node.classes.map((id) => doc.classes[id]).find((cls) => cls?.preset)
}

/** Capture supported base formatting, retaining typed values and project color references. */
export function presetValues(doc: Document, node: Node, computed: Record<string, string>) {
  const names = classNames(doc)
  const classes = node.classes
    .filter((id) => (doc.classes[id]?.combo ?? []).every((parent) => node.classes.includes(parent)))
    .sort((a, b) => {
      const left = selectorFor(doc, names, a, 'none')
      const right = selectorFor(doc, names, b, 'none')
      return (
        left.split('.').length - right.split('.').length ||
        (left < right ? -1 : left > right ? 1 : 0)
      )
    })
  const values: Record<string, CssValue> = {}
  const important = new Set<string>()
  for (const property of properties) {
    if (!property.startsWith('--ff-') && computed[property])
      values[property] = { type: 'raw', value: computed[property]! }
  }
  for (const id of classes) {
    for (const style of Object.values(doc.styles)) {
      if (
        style.class !== id ||
        style.breakpoint !== 'base' ||
        style.state !== 'none' ||
        !properties.has(style.property)
      )
        continue
      if (important.has(style.property) && !style.important) continue
      values[style.property] = structuredClone(style.value)
      if (style.important) important.add(style.property)
    }
  }
  return values
}

export function presetOverrides(doc: Document, node: Node) {
  const local = localClass(doc, node)
  return Object.values(doc.styles).filter(
    (style) =>
      style.class === local &&
      style.breakpoint === 'base' &&
      style.state === 'none' &&
      properties.has(style.property),
  )
}

export function applyPreset(doc: Document, node: Node, id: string): EditOperation[] {
  const preset = doc.classes[id]
  if (id && (!preset?.preset || preset.kind !== 'class' || preset.combo?.length))
    throw new Error('Choose a valid preset.')
  // Isolate imported shared local classes before clearing formatting, just as direct edits do.
  const clear = Object.fromEntries([...properties].map((property) => [property, null]))
  const operations = id ? formattingOperations(doc, node, clear) : []
  const assigned = operations.find((op) => op.type === 'node.update')
  const classes =
    assigned?.type === 'node.update' ? (assigned.classes ?? node.classes) : node.classes
  operations.push({
    type: 'node.update',
    id: node.id,
    classes: [...classes.filter((classId) => !doc.classes[classId]?.preset), ...(id ? [id] : [])],
  })
  return operations
}

export function createPreset(
  doc: Document,
  node: Node,
  name: string,
  computed: Record<string, string>,
  id = `c-${crypto.randomUUID()}`,
): EditOperation[] {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Give your preset a name.')
  if (Object.values(doc.classes).some((cls) => cls.name?.toLowerCase() === trimmed.toLowerCase()))
    throw new Error('This name is already in use.')
  const values = presetValues(doc, node, computed)
  if (!Object.keys(values).length) throw new Error('Select an element with formatting first.')
  const withPreset = {
    ...doc,
    classes: { ...doc.classes, [id]: { id, name: trimmed, kind: 'class' as const, preset: true } },
  }
  return [
    { type: 'class.create', id, name: trimmed, preset: true },
    ...Object.entries(values).map(
      ([property, value]): EditOperation => ({
        type: 'style.set',
        class: id,
        breakpoint: 'base',
        state: 'none',
        property,
        value,
        ...(Object.values(doc.styles).some(
          (style) =>
            node.classes.includes(style.class) && style.property === property && style.important,
        )
          ? { important: true }
          : {}),
      }),
    ),
    ...applyPreset(withPreset, node, id),
  ]
}

export function updatePreset(doc: Document, node: Node): EditOperation[] {
  const preset = activePreset(doc, node)
  if (!preset || preset.locked) throw new Error('This preset cannot be updated.')
  const overrides = presetOverrides(doc, node)
  return [
    ...overrides.map(
      (style): EditOperation => ({
        ...structuredClone(style),
        type: 'style.set',
        class: preset.id,
      }),
    ),
    ...formattingOperations(
      doc,
      node,
      Object.fromEntries(overrides.map((style) => [style.property, null])),
    ),
  ]
}
