import { classNames, compareSelectors, contextFromDocument, serializeValue } from '@freeflow/css'
import type { Operation } from '@freeflow/document'
import {
  type CssValue,
  type Document,
  type Node,
  type State,
  type StyleDecl,
  styleKey,
} from '@freeflow/schema'
import { inheritedBreakpoints } from './breakpoints.js'
import { WEIGHT_NAMES } from './fonts.js'
import { formattingGroups, formattingOperations, localClass } from './formatting.js'
import { nodeLabel, pageOf } from './structure.js'
import { tokenLabel, tokenValue } from './tokens.js'

const properties = new Set<string>(
  formattingGroups.flatMap((group) => group.fields.map((field) => field.property)),
)

export function activePreset(doc: Document, node: Node) {
  return node.classes.map((id) => doc.classes[id]).find((cls) => cls?.preset)
}

/**
 * The declaration that wins each property on this element at this breakpoint and state. Classes
 * apply in selector order and, within one, wider scopes first; a state rule outranks every
 * base-state rule, as its extra specificity does in CSS, and !important outranks both.
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
    .filter((style) => scopes.includes(style.breakpoint) && states.includes(style.state))
    .sort(
      (a, b) =>
        states.indexOf(a.state) - states.indexOf(b.state) ||
        scopes.indexOf(a.breakpoint) - scopes.indexOf(b.breakpoint),
    )
  const winners: Record<string, StyleDecl> = {}
  for (const id of classes) {
    for (const style of styles) {
      if (style.class !== id || (winners[style.property]?.important && !style.important)) continue
      winners[style.property] = style
    }
  }
  return winners
}

/** Capture effective formatting at this breakpoint and state, retaining typed values and color references. */
export function presetValues(
  doc: Document,
  node: Node,
  computed: Record<string, string>,
  breakpoint = 'base',
  state: State = 'none',
) {
  const values: Record<string, CssValue> = {}
  for (const property of properties) {
    if (!property.startsWith('--ff-') && computed[property])
      values[property] = { type: 'raw', value: computed[property]! }
  }
  for (const [property, style] of Object.entries(winningStyles(doc, node, breakpoint, state))) {
    if (properties.has(property)) values[property] = structuredClone(style.value)
  }
  return values
}

const INHERITED = new Set([
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'color',
])
// The template sets sides through shorthands; a longhand field falls back to them.
const shorthands = (property: string) => {
  const [, box, side] = property.match(/^(padding|margin)-(top|right|bottom|left)$/) ?? []
  if (box) return [`${box}-${side === 'top' || side === 'bottom' ? 'block' : 'inline'}`, box]
  return /^border-(color|width|style)$/.test(property) ? ['border'] : []
}

export type StyleSource =
  | ({ kind: 'local' | 'class' | 'preset' } & Pick<
      StyleDecl,
      'class' | 'breakpoint' | 'state' | 'value' | 'property'
    >)
  | { kind: 'inherited'; from: string; source: StyleSource }
  | { kind: 'default' }

/**
 * Where the value of one property comes from: a draft or the winning declaration on this element,
 * else, for an inheritable property, the nearest ancestor that sets it, else the default.
 */
export function styleSource(
  doc: Document,
  node: Node,
  property: string,
  breakpoint = 'base',
  state: State = 'none',
  changes: Record<string, CssValue | null> = {},
): StyleSource {
  const draft = changes[property]
  if (draft) return { kind: 'local', class: '', breakpoint, state, value: draft, property }
  const winners = winningStyles(doc, node, breakpoint, state)
  const style = [property, ...shorthands(property)].map((name) => winners[name]).find(Boolean)
  if (style) {
    const cls = doc.classes[style.class]
    const kind = cls?.kind === 'local' ? 'local' : cls?.preset ? 'preset' : 'class'
    return { kind, ...style }
  }
  const parent = node.parent && doc.nodes[node.parent]
  if (!parent || !INHERITED.has(property)) return { kind: 'default' }
  const source = styleSource(doc, parent, property, breakpoint, state)
  return source.kind === 'default' || source.kind === 'inherited'
    ? source
    : { kind: 'inherited', from: parent.id, source }
}

/** The one-line wording of a source, with the scope it was set at when that is wider than this one. */
/** The line under a field: the effective value, then where it comes from. */
export function sourceLabel(
  doc: Document,
  source: StyleSource,
  breakpoint = 'base',
  state: State = 'none',
  computed?: string,
  property?: string,
): { text: string; title: string; origin: string } {
  const shown = (value?: string) => (value ? weightName(value) : '')
  if (source.kind === 'default') {
    const text = [shown(computed), 'default'].filter(Boolean).join(' · ')
    return { text, title: text, origin: 'default' }
  }
  if (source.kind === 'inherited') {
    const from = elementName(doc, source.from)
    const inner = sourceLabel(doc, source.source, breakpoint, state, computed, property)
    const value = inner.text.slice(0, inner.text.lastIndexOf(' · '))
    return {
      text: `${value} · inherited`,
      title: `${value} · inherited from ${from} (${inner.origin})`,
      origin: 'inherited',
    }
  }
  const name = doc.classes[source.class]?.name
  const token = source.value.type === 'designToken' && doc.designTokens[source.value.ref]
  const resolved = token
    ? serializeValue(tokenValue(doc, token), contextFromDocument(doc))
    : serializeValue(source.value, contextFromDocument(doc))
  // A longhand set through its shorthand shows this side's computed value, not the whole shorthand.
  const shorthand = computed !== undefined && source.property !== property
  const value = token ? tokenLabel(token.name) : shown(shorthand ? computed : resolved)
  const origin = [
    source.kind === 'local' ? 'local' : `${source.kind} ${name}`,
    source.breakpoint !== breakpoint &&
      (doc.breakpoints[source.breakpoint]?.label ?? source.breakpoint),
    source.state !== state && 'base state',
  ]
    .filter(Boolean)
    .join(', ')
  const text = `${value} · ${origin}`
  return { text, title: token ? `${value} = ${resolved} · ${origin}` : text, origin }
}

/** Where a source line leads: the ancestor, class, preset or token it names, with its spoken
 * intent. Local and default values lead nowhere. */
export function sourceTarget(
  doc: Document,
  source: StyleSource,
): { to: 'element' | 'class' | 'preset' | 'token'; id: string; label: string } | undefined {
  if (source.kind === 'inherited')
    return { to: 'element', id: source.from, label: `Go to ${elementName(doc, source.from)}` }
  if (source.kind === 'default') return undefined
  if (source.kind !== 'local') {
    const name = doc.classes[source.class]?.name
    return { to: source.kind, id: source.class, label: `Go to ${source.kind} ${name}` }
  }
  const token = source.value.type === 'designToken' && doc.designTokens[source.value.ref]
  return token
    ? { to: 'token', id: token.id, label: `Go to token ${tokenLabel(token.name)}` }
    : undefined
}

// The page root reads "Body", as in the layers panel.
const elementName = (doc: Document, id: string) =>
  doc.pages[pageOf(doc, id)]?.root === id ? 'Body' : nodeLabel(doc.nodes[id]!)

/** Font weights read as names, as the fonts list shows them. */
const weightName = (value: string) =>
  /^[1-9]00$/.test(value) ? (WEIGHT_NAMES[Number(value) / 100 - 1] ?? value) : value

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
