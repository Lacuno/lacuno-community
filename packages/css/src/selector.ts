import type { Class, Document, State } from '@freeflow/schema'
import { PSEUDO_ELEMENTS } from '@freeflow/schema'

/**
 * Class names as they appear in the output. Named classes keep their user-facing name, made
 * CSS-safe and de-duplicated. Local classes get a short generated name. The mapping is stable
 * for a given document because it is derived by sorted id order.
 */
export type ClassNames = ReadonlyMap<string, string>

export function cssIdent(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const safe = cleaned.length ? cleaned : 'class'
  return /^[0-9-]/.test(safe) ? `c-${safe}` : safe
}

export function classNames(doc: Document): ClassNames {
  const used = new Set<string>()
  const out = new Map<string, string>()
  const ids = Object.keys(doc.classes).sort()
  // Named classes first so they win their preferred name; locals never collide with them.
  for (const id of ids) {
    const cls = doc.classes[id] as Class
    if (cls.kind !== 'class') continue
    const base = cssIdent(cls.name ?? id)
    let name = base
    let n = 2
    while (used.has(name)) name = `${base}-${n++}`
    used.add(name)
    out.set(id, name)
  }
  for (const id of ids) {
    const cls = doc.classes[id] as Class
    if (cls.kind !== 'local') continue
    let name = `ff-${cssIdent(id)}`
    let n = 2
    while (used.has(name)) name = `ff-${cssIdent(id)}-${n++}`
    used.add(name)
    out.set(id, name)
  }
  return out
}

const STATE_SELECTOR: Record<State, string> = {
  none: '',
  hover: ':hover',
  focus: ':focus',
  'focus-visible': ':focus-visible',
  'focus-within': ':focus-within',
  active: ':active',
  visited: ':visited',
  disabled: ':disabled',
  checked: ':checked',
  empty: ':empty',
  'first-child': ':first-child',
  'last-child': ':last-child',
  odd: ':nth-child(odd)',
  even: ':nth-child(even)',
  placeholder: '::placeholder',
  before: '::before',
  after: '::after',
  marker: '::marker',
  selection: '::selection',
}

export function isPseudoElement(state: State): boolean {
  return PSEUDO_ELEMENTS.has(state)
}

/** `.button.primary:hover` for a combo class with a state. */
export function selectorFor(
  doc: Document,
  names: ClassNames,
  classId: string,
  state: State,
): string {
  const cls = doc.classes[classId]
  if (!cls) throw new Error(`unknown class ${classId}`)
  const chain = [...(cls.combo ?? []), classId].map((id) => {
    const n = names.get(id)
    if (!n) throw new Error(`no class name for ${id}`)
    return `.${n}`
  })
  // Direct formatting wins over reusable rules, including combo and state selectors.
  // Keep this in the shared generator so canvas and published output agree.
  if (cls.kind === 'local') {
    const specificity =
      Math.max(
        1,
        ...Object.values(doc.classes)
          .filter((item) => item.kind !== 'local')
          .map((item) => (item.combo?.length ?? 0) + 2),
      ) + 1
    while (chain.length < specificity) chain.push(`.${names.get(classId)}`)
  }
  return `${chain.join('')}${STATE_SELECTOR[state]}`
}

/** Class attribute value for a node, in node order. */
export function classAttr(names: ClassNames, classIds: readonly string[]): string {
  return classIds
    .map((id) => names.get(id) ?? '')
    .filter(Boolean)
    .join(' ')
}
