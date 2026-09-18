import { classNames, selectorFor } from '@freeflow/css'
import type { CssValue, Document, Node, StyleDecl } from '@freeflow/schema'
import { styleKey } from '@freeflow/schema'
import type { EditOperation } from './history.js'

export const formattingGroups = [
  {
    name: 'Typography',
    fields: [
      {
        property: 'font-family',
        label: 'Font',
        choices: ['Inter, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'monospace'],
      },
      { property: 'font-size', label: 'Size', hint: 'e.g. 24px' },
      { property: 'font-weight', label: 'Weight', choices: ['400', '500', '600', '700', '800'] },
      { property: 'font-style', label: 'Style', choices: ['normal', 'italic'] },
      {
        property: 'text-align',
        label: 'Alignment',
        choices: ['left', 'center', 'right', 'justify'],
      },
      { property: 'line-height', label: 'Line height', hint: 'e.g. 1.5' },
    ],
  },
  {
    name: 'Colors',
    fields: [
      { property: 'color', label: 'Text color' },
      { property: 'background-color', label: 'Background color' },
      { property: 'border-color', label: 'Border color' },
    ],
  },
  {
    name: 'Spacing & shape',
    fields: [
      { property: 'padding', label: 'Inside spacing', hint: 'e.g. 16px' },
      { property: 'margin', label: 'Outside spacing', hint: 'e.g. 16px' },
      { property: 'gap', label: 'Item spacing', hint: 'e.g. 12px' },
      { property: 'border-radius', label: 'Corner radius', hint: 'e.g. 8px' },
      { property: 'border-width', label: 'Border width', hint: 'e.g. 1px' },
      {
        property: 'border-style',
        label: 'Border style',
        choices: ['none', 'solid', 'dashed', 'dotted'],
      },
    ],
  },
] as const

/** Only reuse a local style owned exclusively by this element. */
export function localClass(doc: Document, node: Node): string | undefined {
  const locals = node.classes.filter((id) => doc.classes[id]?.kind === 'local')
  if (locals.length !== 1) return undefined
  return locals.find(
    (id) =>
      doc.classes[id]?.kind === 'local' &&
      !doc.classes[id]?.locked &&
      !doc.classes[id]?.combo?.length &&
      Object.values(doc.nodes).every(
        (other) => other.id === node.id || !other.classes.includes(id),
      ),
  )
}
export function localValue(doc: Document, node: Node, property: string): CssValue | undefined {
  const id = localClass(doc, node)
  return id
    ? doc.styles[styleKey({ class: id, breakpoint: 'base', state: 'none', property })]?.value
    : undefined
}
export function formattingOperations(
  doc: Document,
  node: Node,
  changes: Record<string, CssValue | null>,
  makeId = () => `c-${crypto.randomUUID()}`,
): EditOperation[] {
  const operations: EditOperation[] = []
  let id = localClass(doc, node)
  if (!id && Object.values(changes).some((value) => value !== null)) {
    id = makeId()
    operations.push(
      { type: 'class.create', id, local: true },
      {
        type: 'node.update',
        id: node.id,
        classes: [...node.classes.filter((classId) => doc.classes[classId]?.kind !== 'local'), id],
      },
    )
    // Imported documents can share local classes or carry several. Copy their effective
    // declarations into the new private style, removing those classes only from this node.
    const names = classNames(doc)
    const locals = node.classes.filter(
      (classId) =>
        doc.classes[classId]?.kind === 'local' &&
        (doc.classes[classId]?.combo ?? []).every((parent) => node.classes.includes(parent)),
    )
    locals.sort((a, b) => {
      const left = selectorFor(doc, names, a, 'none')
      const right = selectorFor(doc, names, b, 'none')
      return (
        left.split('.').length - right.split('.').length ||
        (left < right ? -1 : left > right ? 1 : 0)
      )
    })
    const inherited = new Map<string, StyleDecl>()
    for (const classId of locals) {
      for (const style of Object.values(doc.styles).filter((style) => style.class === classId)) {
        const copy = { ...structuredClone(style), class: id }
        const key = styleKey(copy)
        if (!inherited.get(key)?.important || copy.important) inherited.set(key, copy)
      }
    }
    for (const style of inherited.values()) {
      if (style.breakpoint === 'base' && style.state === 'none' && style.property in changes)
        continue
      operations.push({ type: 'style.set', ...style })
    }
  }
  if (!id) return operations
  for (const [property, value] of Object.entries(changes)) {
    const coordinates = { class: id, breakpoint: 'base', state: 'none' as const, property }
    if (value) {
      const important = Object.values(doc.styles).some(
        (style) =>
          node.classes.includes(style.class) && style.property === property && style.important,
      )
      operations.push({
        type: 'style.set',
        ...coordinates,
        value,
        ...(important ? { important: true } : {}),
      })
    } else if (doc.styles[styleKey(coordinates)])
      operations.push({ type: 'style.clear', ...coordinates })
  }
  return operations
}

/** Plain numeric sizes use pixels; unitless typography values retain their meaning. */
export function normalizeFormatting(
  changes: Record<string, CssValue | null>,
): Record<string, CssValue | null> {
  const lengths = new Set([
    'font-size',
    'padding',
    'margin',
    'gap',
    'border-radius',
    'border-width',
  ])
  return Object.fromEntries(
    Object.entries(changes).map(([property, value]) => {
      if (
        lengths.has(property) &&
        value?.type === 'raw' &&
        /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.value.trim())
      ) {
        return [property, { type: 'unit', value: Number(value.value), unit: 'px' }]
      }
      return [property, value]
    }),
  )
}
