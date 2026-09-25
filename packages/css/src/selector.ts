import type { Class, Document, State } from '@lacuno/schema'

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
    let name = `lc-${cssIdent(id)}`
    let n = 2
    while (used.has(name)) name = `lc-${cssIdent(id)}-${n++}`
    used.add(name)
    out.set(id, name)
  }
  return out
}

/**
 * States the live pointer or keyboard focus can trigger. In the canvas their real pseudo-class is
 * dropped so only the state picker turns them on; structural states (`:first-child`, `:empty`, …)
 * keep it, so the base view still matches the published site.
 */
export const LIVE_STATES = new Set<State>([
  'hover',
  'focus',
  'focus-visible',
  'focus-within',
  'active',
])

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

/**
 * How deep a preset or local selector has to repeat itself to outrank the shared classes of a
 * document. It depends on the whole class table, so it is derived once per name map rather than
 * once per selector.
 */
const padding = new WeakMap<ClassNames, { shared: number; presets: boolean }>()

function paddingFor(doc: Document, names: ClassNames): { shared: number; presets: boolean } {
  let pad = padding.get(names)
  if (!pad) {
    const all = Object.values(doc.classes)
    pad = {
      shared: Math.max(
        1,
        ...all
          .filter((item) => item.kind !== 'local' && !item.preset)
          .map((item) => (item.combo?.length ?? 0) + 2),
      ),
      presets: all.some((item) => item.preset),
    }
    padding.set(names, pad)
  }
  return pad
}

/**
 * `.button.primary:hover` for a combo class with a state. In the canvas (`forced`) the state
 * picker drives styles through `.button.primary[data-lc-state="hover"]`: interaction states
 * emit only that form so the live pointer can't trigger them, structural states emit both, and
 * pseudo-elements, which the picker cannot force onto the element itself, emit only their own.
 */
export function selectorFor(
  doc: Document,
  names: ClassNames,
  classId: string,
  state: State,
  forced = false,
): string {
  const cls = doc.classes[classId]
  if (!cls) throw new Error(`unknown class ${classId}`)
  const chain = [...(cls.combo ?? []), classId].map((id) => {
    const n = names.get(id)
    if (!n) throw new Error(`no class name for ${id}`)
    return `.${n}`
  })
  // Presets override ordinary shared styles; direct formatting overrides presets.
  // Use the same specificity in the canvas and published output.
  if (cls.preset || cls.kind === 'local') {
    const pad = paddingFor(doc, names)
    const specificity = pad.shared + (cls.kind === 'local' && pad.presets ? 3 : 1)
    while (chain.length < specificity) chain.push(`.${names.get(classId)}`)
  }
  const base = chain.join('')
  const real = `${base}${STATE_SELECTOR[state]}`
  if (!forced || state === 'none' || STATE_SELECTOR[state].startsWith('::')) return real
  const picked = `${base}[data-lc-state="${state}"]`
  return LIVE_STATES.has(state) ? picked : `${real}, ${picked}`
}

/** Emission order: fewer compound parts first, then alphabetical, so combos follow their parents. */
export function compareSelectors(
  doc: Document,
  names: ClassNames,
): (a: string, b: string) => number {
  return (a, b) => {
    const left = selectorFor(doc, names, a, 'none')
    const right = selectorFor(doc, names, b, 'none')
    return (
      left.split('.').length - right.split('.').length || (left < right ? -1 : left > right ? 1 : 0)
    )
  }
}

/** Class attribute value for a node, in node order. */
export function classAttr(names: ClassNames, classIds: readonly string[]): string {
  return classIds
    .map((id) => names.get(id) ?? '')
    .filter(Boolean)
    .join(' ')
}
