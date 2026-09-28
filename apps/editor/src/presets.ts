import { classNames, compareSelectors } from '@lacuno/css'
import type { Operation } from '@lacuno/document'
import {
  type CssValue,
  type Document,
  type Node,
  type State,
  type StyleDecl,
  styleKey,
} from '@lacuno/schema'
import { inheritedBreakpoints } from './breakpoints.js'
import {
  clearStyles,
  formattingGroups,
  formattingOperations,
  important,
  localClass,
} from './formatting.js'

// The spacing shorthands too, so presets keep a class's token and see legacy local shorthands.
const properties = new Set<string>([
  ...formattingGroups.flatMap((group) => group.fields.map((field) => field.property)),
  'padding',
  'margin',
])

export function activePreset(doc: Document, node: Node) {
  return node.classes.map((id) => doc.classes[id]).find((cls) => cls?.preset)
}

/**
 * The declaration that wins each property on this element at this breakpoint and state, ranked
 * as CSS ranks them: a state rule outranks every base-state rule by its extra specificity, a
 * narrower breakpoint's media block comes later in the stylesheet than wider ones, then classes
 * apply in selector order; !important outranks all of these.
 */
export function winningStyles(
  doc: Document,
  node: Node,
  breakpoint = 'base',
  state: State = 'none',
) {
  const names = classNames(doc)
  const classes = node.classes
    .filter((id) => (doc.classes[id]?.combo ?? []).every((parent) => node.classes.includes(parent)))
    .sort(compareSelectors(doc, names))
  const scopes = inheritedBreakpoints(doc, breakpoint)
  const states: State[] = state === 'none' ? ['none'] : ['none', state]
  const styles = Object.values(doc.styles)
    .filter(
      (style) =>
        classes.includes(style.class) &&
        !style.tag &&
        scopes.includes(style.breakpoint) &&
        states.includes(style.state),
    )
    .sort(
      (a, b) =>
        states.indexOf(a.state) - states.indexOf(b.state) ||
        scopes.indexOf(a.breakpoint) - scopes.indexOf(b.breakpoint) ||
        classes.indexOf(a.class) - classes.indexOf(b.class),
    )
  const winners: Record<string, StyleDecl> = {}
  for (const style of styles) {
    if (winners[style.property]?.important && !style.important) continue
    winners[style.property] = style
  }
  return winners
}

/**
 * Capture effective formatting at this breakpoint and state, retaining typed values, color and
 * token references. A side set through a shorthand keeps the shorthand, token and all.
 */
export function presetValues(
  doc: Document,
  node: Node,
  computed: Record<string, string>,
  breakpoint = 'base',
  state: State = 'none',
) {
  const winners = winningStyles(doc, node, breakpoint, state)
  const values: Record<string, CssValue> = {}
  for (const property of properties) {
    const style = [property, ...shorthands(property)].map((name) => winners[name]).find(Boolean)
    if (style) values[style.property] = structuredClone(style.value)
    else if (!property.startsWith('--lc-') && computed[property])
      values[property] = { type: 'raw', value: computed[property]! }
  }
  return values
}

// The template sets sides through shorthands; a longhand field falls back to them.
const shorthands = (property: string) => {
  const [, box, side] = property.match(/^(padding|margin)-(top|right|bottom|left)$/) ?? []
  if (box) return [`${box}-${side === 'top' || side === 'bottom' ? 'block' : 'inline'}`, box]
  return /^border-(color|width|style)$/.test(property) ? ['border'] : []
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
        ...(important(doc, node, property) ? { important: true } : {}),
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
                !style.tag &&
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
    ...clearStyles(doc, node, overrides, breakpoint),
  ]
}
