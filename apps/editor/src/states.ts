import type { Document, Node, State } from '@freeflow/schema'

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

/** The states that can actually happen to this element: no focus on a div, no visited on a span. */
export function applicableStates(doc: Document, node: Node): State[] {
  const tag = 'tag' in node ? node.tag : ''
  const attrs = 'attrs' in node ? (node.attrs ?? {}) : {}
  const link = tag === 'a' && 'href' in attrs
  const focusable = link || focusableTags.has(tag) || 'tabindex' in attrs
  const siblings = !!node.parent && (doc.nodes[node.parent]?.children.length ?? 0) > 1
  return (Object.keys(STATES) as State[]).filter((state) => {
    if (state === 'focus' || state === 'focus-visible') return focusable
    if (state === 'visited') return link
    if (['first-child', 'last-child', 'odd', 'even'].includes(state)) return siblings
    return true
  })
}
