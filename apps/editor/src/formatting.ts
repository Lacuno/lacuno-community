import { classNames, compareSelectors } from '@freeflow/css'
import type { Operation } from '@freeflow/document'
import { nodesUsingClass } from '@freeflow/document/references'
import type { CssValue, Document, Node, State, StyleDecl } from '@freeflow/schema'
import { styleKey } from '@freeflow/schema'
import { FONT_STACKS } from './fonts.js'

export const formattingGroups = [
  {
    name: 'Typography',
    fields: [
      // The site's families come first; FormattingControls lists fontChoices(doc).
      { property: 'font-family', label: 'Font', choices: FONT_STACKS },
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
    name: 'Layout',
    fields: [
      { property: 'object-fit', label: 'Image fit' },
      { property: 'object-position', label: 'Image focal point' },
      { property: 'display', label: 'Layout type', choices: ['block', 'flex', 'grid'] },
      {
        property: 'flex-direction',
        label: 'Direction',
        choices: ['row', 'column', 'row-reverse', 'column-reverse'],
      },
      { property: 'flex-wrap', label: 'Wrapping', choices: ['nowrap', 'wrap'] },
      {
        property: 'justify-content',
        label: 'Distribute items',
        choices: [
          'flex-start',
          'center',
          'flex-end',
          'space-between',
          'space-around',
          'space-evenly',
        ],
      },
      {
        property: 'align-items',
        label: 'Align items',
        choices: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
      },
      {
        property: 'grid-template-columns',
        label: 'Grid columns',
        hint: 'e.g. repeat(3, minmax(0, 1fr))',
      },
      { property: 'width', label: 'Width', hint: 'auto, 100%, or 320px' },
      { property: 'height', label: 'Height', hint: 'auto or 240px' },
      { property: 'min-width', label: 'Minimum width', hint: 'e.g. 0px' },
      { property: 'max-width', label: 'Maximum width', hint: 'e.g. 1100px' },
    ],
  },
  {
    name: 'Spacing & shape',
    fields: [
      { property: 'padding-top', label: 'Inside spacing top' },
      { property: 'padding-right', label: 'Inside spacing right' },
      { property: 'padding-bottom', label: 'Inside spacing bottom' },
      { property: 'padding-left', label: 'Inside spacing left' },
      { property: 'margin-top', label: 'Outside spacing top' },
      { property: 'margin-right', label: 'Outside spacing right' },
      { property: 'margin-bottom', label: 'Outside spacing bottom' },
      { property: 'margin-left', label: 'Outside spacing left' },
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
  {
    name: 'Effects',
    fields: [
      { property: 'opacity', label: 'Opacity' },
      { property: 'rotate', label: 'Rotation' },
      { property: 'scale', label: 'Scale' },
      { property: 'transform', label: 'Tilt' },
      { property: 'box-shadow', label: 'Shadow' },
    ],
  },
  {
    name: 'Motion',
    fields: [
      { property: '--ff-duration', label: 'Duration' },
      { property: '--ff-delay', label: 'Delay' },
      { property: '--ff-easing', label: 'Easing' },
      { property: '--ff-entrance', label: 'Entrance' },
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
      nodesUsingClass(doc, id).every((other) => other === node.id),
  )
}
export function localValue(
  doc: Document,
  node: Node,
  property: string,
  breakpoint = 'base',
  state: State = 'none',
): CssValue | undefined {
  const id = localClass(doc, node)
  return id ? doc.styles[styleKey({ class: id, breakpoint, state, property })]?.value : undefined
}
export function formattingOperations(
  doc: Document,
  node: Node,
  changes: Record<string, CssValue | null>,
  makeId = () => `c-${crypto.randomUUID()}`,
  breakpoint = 'base',
  state: State = 'none',
): Operation[] {
  const operations: Operation[] = []
  let id = localClass(doc, node)
  if (
    !id &&
    (Object.values(changes).some((value) => value !== null) ||
      Object.values(doc.styles).some(
        (style) =>
          node.classes.includes(style.class) &&
          doc.classes[style.class]?.kind === 'local' &&
          style.breakpoint === breakpoint &&
          style.state === state &&
          style.property in changes,
      ))
  ) {
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
    locals.sort(compareSelectors(doc, names))
    const inherited = new Map<string, StyleDecl>()
    for (const classId of locals) {
      for (const style of Object.values(doc.styles).filter((style) => style.class === classId)) {
        const copy = { ...structuredClone(style), class: id }
        const key = styleKey(copy)
        if (!inherited.get(key)?.important || copy.important) inherited.set(key, copy)
      }
    }
    for (const style of inherited.values()) {
      if (style.breakpoint === breakpoint && style.state === state && style.property in changes)
        continue
      operations.push({ type: 'style.set', ...style })
    }
  }
  if (!id) return operations
  for (const [property, value] of Object.entries(changes)) {
    const coordinates = { class: id, breakpoint, state, property }
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
    'width',
    'height',
    'min-width',
    'max-width',
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'margin',
    'margin-top',
    'margin-right',
    'margin-bottom',
    'margin-left',
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
