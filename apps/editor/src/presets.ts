import { classNames, compareSelectors } from '@freeflow/css'
import type { Operation } from '@freeflow/document'
import { type CssValue, type Document, type Node, type State, styleKey } from '@freeflow/schema'
import { inheritedBreakpoints } from './breakpoints.js'
import { formattingGroups, formattingOperations, localClass } from './formatting.js'

const properties = new Set<string>(
  formattingGroups.flatMap((group) => group.fields.map((field) => field.property)),
)

export function activePreset(doc: Document, node: Node) {
  return node.classes.map((id) => doc.classes[id]).find((cls) => cls?.preset)
}

/**
 * Capture effective formatting at this breakpoint and state, retaining typed values and color
 * references. A state rule outranks every base-state rule, as its extra specificity does in CSS.
 */
export function presetValues(
  doc: Document,
  node: Node,
  computed: Record<string, string>,
  breakpoint = 'base',
  state: State = 'none',
) {
  const names = classNames(doc)
  const classes = node.classes
    .filter((id) => (doc.classes[id]?.combo ?? []).every((parent) => node.classes.includes(parent)))
    .sort(compareSelectors(doc, names))
  const values: Record<string, CssValue> = {}
  const important = new Set<string>()
  for (const property of properties) {
    if (!property.startsWith('--ff-') && computed[property])
      values[property] = { type: 'raw', value: computed[property]! }
  }
  const scopes = inheritedBreakpoints(doc, breakpoint)
  const states: State[] = state === 'none' ? ['none'] : ['none', state]
  for (const id of classes) {
    for (const style of Object.values(doc.styles).sort(
      (a, b) =>
        states.indexOf(a.state) - states.indexOf(b.state) ||
        scopes.indexOf(a.breakpoint) - scopes.indexOf(b.breakpoint),
    )) {
      if (
        style.class !== id ||
        !scopes.includes(style.breakpoint) ||
        !states.includes(style.state) ||
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

export function presetOverrides(doc: Document, node: Node, breakpoint = 'base') {
  const local = localClass(doc, node)
  return Object.values(doc.styles).filter(
    (style) =>
      style.class === local &&
      style.breakpoint === breakpoint &&
      style.state === 'none' &&
      properties.has(style.property),
  )
}

export function applyPreset(doc: Document, node: Node, id: string): Operation[] {
  const preset = doc.classes[id]
  if (id && (!preset?.preset || preset.kind !== 'class' || preset.combo?.length))
    throw new Error('Choose a valid preset.')
  // Isolate imported shared local classes before clearing formatting, just as direct edits do.
  const clear = Object.fromEntries([...properties].map((property) => [property, null]))
  const operations: Operation[] = []
  const draft = structuredClone(doc)
  if (id) {
    for (const bp of Object.keys(doc.breakpoints)) {
      const next = formattingOperations(draft, draft.nodes[node.id]!, clear, undefined, bp)
      operations.push(...next)
      for (const op of next) {
        if (op.type === 'class.create' && op.id) draft.classes[op.id] = { id: op.id, kind: 'local' }
        else if (op.type === 'node.update' && op.classes) draft.nodes[node.id]!.classes = op.classes
        else if (op.type === 'style.set') {
          const { type: _, ...style } = op
          draft.styles[styleKey(style)] = style
        } else if (op.type === 'style.clear') delete draft.styles[styleKey(op)]
      }
    }
  }
  const classes = draft.nodes[node.id]!.classes
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
  breakpoint = 'base',
): Operation[] {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Give your preset a name.')
  if (Object.values(doc.classes).some((cls) => cls.name?.toLowerCase() === trimmed.toLowerCase()))
    throw new Error('This name is already in use.')
  const values = presetValues(doc, node, breakpoint === 'base' ? computed : {})
  if (!Object.keys(values).length) throw new Error('Select an element with formatting first.')
  const withPreset = {
    ...doc,
    classes: { ...doc.classes, [id]: { id, name: trimmed, kind: 'class' as const, preset: true } },
  }
  return [
    { type: 'class.create', id, name: trimmed, preset: true },
    ...Object.entries(values).map(
      ([property, value]): Operation => ({
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
    ...Object.keys(doc.breakpoints)
      .filter((bp) => bp !== 'base')
      .flatMap((bp) => {
        const explicit = new Set(
          Object.values(doc.styles)
            .filter(
              (style) =>
                node.classes.includes(style.class) &&
                style.breakpoint === bp &&
                style.state === 'none',
            )
            .map((style) => style.property),
        )
        return Object.entries(presetValues(doc, node, {}, bp))
          .filter(([property]) => explicit.has(property))
          .map(
            ([property, value]): Operation => ({
              type: 'style.set',
              class: id,
              breakpoint: bp,
              state: 'none',
              property,
              value,
            }),
          )
      }),
    ...applyPreset(withPreset, node, id),
  ]
}

export function updatePreset(doc: Document, node: Node, breakpoint = 'base'): Operation[] {
  const preset = activePreset(doc, node)
  if (!preset || preset.locked) throw new Error('This preset cannot be updated.')
  const overrides = presetOverrides(doc, node, breakpoint)
  return [
    ...overrides.map(
      (style): Operation => ({
        ...structuredClone(style),
        type: 'style.set',
        class: preset.id,
      }),
    ),
    ...formattingOperations(
      doc,
      node,
      Object.fromEntries(overrides.map((style) => [style.property, null])),
      undefined,
      breakpoint,
    ),
  ]
}
