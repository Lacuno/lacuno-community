import { classNames, generateStylesheet } from '@freeflow/css'
import { type Document as SiteDocument, styleKey } from '@freeflow/schema'
import type { InsertNode } from './history.js'
import { type DragItem, structureInsertion } from './structure.js'

/** Use the same preset nodes and styles as the eventual insertion, without editing the document. */
export function dragInsertion(
  surface: Document,
  doc: SiteDocument,
  item: Extract<DragItem, { preset: string }>,
  siteId: string,
) {
  const insertion = structureInsertion(
    item.preset,
    { parent: '', index: 0 },
    item.classId,
    false,
    item.assetId,
  )
  const draft = { ...doc, classes: { ...doc.classes }, styles: {} as SiteDocument['styles'] }
  for (const operation of insertion.operations) {
    if (operation.type === 'class.create' && operation.id)
      draft.classes[operation.id] = { id: operation.id, kind: 'local' }
    if (operation.type === 'style.set') {
      const { type: _, ...style } = operation
      draft.styles[styleKey(style)] = style
    }
  }
  const names = classNames(draft)
  const assetUrl = (id: string) =>
    doc.assets[id] && `/api/sites/${encodeURIComponent(siteId)}/assets/${doc.assets[id]!.hash}`
  const render = (node: InsertNode): HTMLElement => {
    const placeholder = node.tag === 'img' && !node.attrs?.src
    const element = surface.createElement(placeholder ? 'div' : node.tag)
    element.dataset.freeflowNode = node.id
    element.className = node.classes
      .map((id) => names.get(id))
      .filter(Boolean)
      .join(' ')
    if (placeholder) element.setAttribute('data-freeflow-image-placeholder', '')
    if (node.type === 'text' && node.text.type === 'static')
      element.textContent = String(node.text.value)
    for (const [name, value] of Object.entries(node.attrs ?? {})) {
      if (value.type === 'static') element.setAttribute(name, String(value.value))
      if (value.type === 'asset' && assetUrl(value.asset))
        element.setAttribute(name, assetUrl(value.asset)!)
    }
    for (const child of node.children ?? []) element.append(render(child))
    return element
  }
  const style = surface.createElement('style')
  style.textContent = generateStylesheet(draft, { reset: false, assetUrl }).css
  surface.head.append(style)
  return render(insertion.node)
}
