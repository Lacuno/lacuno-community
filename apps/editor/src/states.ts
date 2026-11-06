import type { Document, Node, NodeId, State, StateKey } from '@lacuno/schema'
import { PARENT_STATES, stateCoordinates } from '@lacuno/schema'
import { nodeLabel } from './structure.js'

export type StateInfo = { label: string; hint: string; icon: string }

const lines = (bold: number[]) =>
  [3, 6.5, 10, 13.5]
    .map((y, i) => `<path d="M2.5 ${y}h11" stroke-width="${bold.includes(i) ? 3 : 1.5}"/>`)
    .join('')

/**
 * The states the picker offers, in menu order, with a one-line meaning and a 16px icon.
 * The schema carries more; they wait for form controls in the palette and a content field
 * for the pseudo-elements.
 */
export const STATES: Partial<Record<State, StateInfo>> = {
  none: {
    label: 'Default',
    hint: 'How the element normally looks',
    icon: '<circle cx="8" cy="8" r="5"/>',
  },
  hover: {
    label: 'Hover',
    hint: 'While the pointer is over it',
    icon: '<path d="M4 2l9 7-4 1 2 4-2 1-2-4-3 3z"/>',
  },
  focus: {
    label: 'Focus',
    hint: 'While it has focus',
    icon: '<path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3"/>',
  },
  'focus-visible': {
    label: 'Focus visible',
    hint: 'Focused with the keyboard',
    icon: '<path d="M1.5 4.5h13v7h-13zM4 7h1M7 7h1M10 7h1M4 9.5h8"/>',
  },
  active: {
    label: 'Active',
    hint: 'While being pressed',
    icon: '<path d="M5 4l8 6-3.5 1 1.5 3.5-2 1L7.5 12 5 14zM2 2l1.5 1.5M1 6h2M6 1v2"/>',
  },
  visited: {
    label: 'Visited',
    hint: 'A link the visitor has opened',
    icon: '<path d="M3 8.5l3 3 7-7"/>',
  },
  open: {
    label: 'Open',
    hint: 'While it is open',
    icon: '<path d="M2.5 3h11v3.5h-11zM4.5 9.5h7M4.5 12.5h4"/>',
  },
  target: {
    label: 'Jumped to',
    hint: 'After a link to its anchor brought the visitor here',
    icon: '<path d="M6.5 2.5 5 13.5M11 2.5 9.5 13.5M2.5 6h11M2 10h11"/>',
  },
  'first-child': {
    label: 'First',
    hint: 'First among its siblings',
    icon: lines([0]),
  },
  'last-child': {
    label: 'Last',
    hint: 'Last among its siblings',
    icon: lines([3]),
  },
  odd: { label: 'Odd', hint: 'First, third, fifth sibling…', icon: lines([0, 2]) },
  even: { label: 'Even', hint: 'Second, fourth, sixth sibling…', icon: lines([1, 3]) },
}

export const stateInfo = (state: State): StateInfo =>
  STATES[state] ?? { label: state, hint: '', icon: '' }

const focusableTags = new Set(['button', 'input', 'select', 'textarea', 'summary', 'iframe'])

const attrsOf = (node: Node) => ('attrs' in node ? (node.attrs ?? {}) : {})

/** An accordion item, a dialog, a menu panel, or what holds a menu panel, as a Menu does. */
function openable(doc: Document, node: Node) {
  const tag = 'tag' in node ? node.tag : ''
  return (
    tag === 'details' ||
    tag === 'dialog' ||
    'popover' in attrsOf(node) ||
    node.children.some((id) => {
      const child = doc.nodes[id]
      return !!child && 'popover' in attrsOf(child)
    })
  )
}

/** The states that can actually happen to this element: no focus on a div, no visited on a span. */
export function applicableStates(doc: Document, node: Node): State[] {
  const tag = 'tag' in node ? node.tag : ''
  const attrs = attrsOf(node)
  const link = tag === 'a' && 'href' in attrs
  const focusable = link || focusableTags.has(tag) || 'tabindex' in attrs
  const siblings = !!node.parent && (doc.nodes[node.parent]?.children.length ?? 0) > 1
  return (Object.keys(STATES) as State[]).filter((state) => {
    if (state === 'focus' || state === 'focus-visible') return focusable
    if (state === 'visited') return link
    if (state === 'open') return openable(doc, node)
    if (state === 'target') return attrs.id?.type === 'static' && !!attrs.id.value
    if (['first-child', 'last-child', 'odd', 'even'].includes(state)) return siblings
    return true
  })
}

/** An entry of the state menu: the element's own state, or a parent's, on `trigger`. */
export type StateOption = StateInfo & { key: StateKey; trigger?: NodeId }

export const ownState = (state: State): StateOption => ({ key: state, ...stateInfo(state) })

const PARENT_HINTS: Record<string, (name: string) => string> = {
  hover: (name) => `While the pointer is over ${name}`,
  'focus-within': (name) => `While something in ${name} has focus`,
  open: (name) => `While ${name} is open`,
  target: (name) => `After a link jumped to ${name}`,
}

/** "Card · Hover": a parent's state, by its first class unless a style names another. */
function parentState(on: Node, state: State, of = on.classes[0]): StateOption | undefined {
  if (!of) return undefined
  const name = nodeLabel(on)
  const info =
    state === 'focus-within' ? { ...stateInfo('focus'), label: 'Focus inside' } : stateInfo(state)
  const short = name.length > 14 ? `${name.slice(0, 13)}…` : name
  return {
    key: `${state}@${of}`,
    label: `${short} · ${info.label}`,
    hint: PARENT_HINTS[state]!(name),
    icon: info.icon,
    trigger: on.id,
  }
}

/** What the state was picked for: the key and the element it was picked on. */
export type PickedState = { key: StateKey; on: NodeId }

/**
 * The state menu of an element: its own states, then a few of its parents': the nearest one that
 * opens, the nearest link or button or parent with hover styles of its own, a parent whose state
 * the element already follows, and the parent a state was picked on.
 */
export function stateOptions(doc: Document, node: Node, picked?: PickedState): StateOption[] {
  const parents: Node[] = []
  for (let id = node.parent; id; id = doc.nodes[id]?.parent ?? null) {
    const parent = doc.nodes[id]
    if (parent) parents.push(parent)
  }
  const options: StateOption[] = []
  const add = (option: StateOption | undefined) => {
    if (option && !options.some((other) => other.key === option.key)) options.push(option)
  }
  const opens = parents.find((parent) => openable(doc, parent))
  if (opens) add(parentState(opens, 'open'))
  const hovers = parents.find((parent) => {
    const tag = 'tag' in parent ? parent.tag : ''
    return (
      (tag === 'a' && 'href' in attrsOf(parent)) ||
      tag === 'button' ||
      Object.values(doc.styles).some(
        (style) => style.state === 'hover' && !style.of && parent.classes.includes(style.class),
      )
    )
  })
  if (hovers) add(parentState(hovers, 'hover'))
  for (const style of Object.values(doc.styles)) {
    if (!style.of || !node.classes.includes(style.class)) continue
    const on = parents.find((parent) => parent.classes.includes(style.of!))
    if (on) add(parentState(on, style.state, style.of))
  }
  const own = picked && stateCoordinates(picked.key)
  const on = own && !own.of && parents.find((parent) => parent.id === picked.on)
  if (on && PARENT_STATES.includes(own.state)) add(parentState(on, own.state))
  return [...applicableStates(doc, node).map(ownState), ...options]
}

/**
 * The entry in effect. A state picked on a parent goes on for what is selected inside it, as that
 * parent's state; a parent's state picked inside it is its own on the parent itself; anything else
 * stays while the element can be in it.
 */
export function pickedOption(node: Node, options: StateOption[], picked: PickedState): StateOption {
  const { state, of } = stateCoordinates(picked.key)
  const fallback = options[0]!
  if (!of && picked.on !== node.id) {
    const carried = options.find(
      (option) => option.trigger === picked.on && stateCoordinates(option.key).state === state,
    )
    if (carried) return carried
  }
  const key = of && node.classes.includes(of) ? state : picked.key
  return options.find((option) => option.key === key) ?? fallback
}
