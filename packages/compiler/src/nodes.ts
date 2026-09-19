import { type ClassNames, classAttr } from '@freeflow/css'
import type {
  AssetRef,
  Binding,
  Document,
  ElementNode,
  Node,
  NodeId,
  RichText,
} from '@freeflow/schema'
import { isOptimizedImage, publicAssetPath } from './assets.js'
import { RenderError } from './errors.js'
import { type AttrMap, escapeHtml, renderAttrs, VOID_TAGS } from './html.js'
import type { ImageResolver } from './images.js'
import { applyQuery } from './query.js'
import { richTextInlineHtml, richTextToHtml } from './richtext.js'
import type { Frame } from './scope.js'
import { type Resolved, resolveBinding, type Scope } from './scope.js'

export type Warning = { node: string; message: string }

export type RenderState = {
  doc: Document
  names: ClassNames
  resolveImage: ImageResolver
  page: string
  warnings: Warning[]
  annotateNodes?: boolean
  resolveAsset?: (asset: AssetRef) => string
}

const DEFAULT_SIZES = '100vw'

function getNode(state: RenderState, id: NodeId): Node {
  const node = state.doc.nodes[id]
  if (!node) throw new RenderError(`unknown node ${id}`, id, state.page)
  return node
}

function checkClasses(node: Node, state: RenderState): void {
  for (const c of node.classes) {
    if (!state.doc.classes[c]) throw new RenderError(`unknown class ${c}`, node.id, state.page)
  }
}

function isAsset(v: Resolved): v is AssetRef {
  return typeof v === 'object' && v !== null && 'hash' in v
}

function isRichText(v: Resolved): v is RichText {
  return typeof v === 'object' && v !== null && (v as RichText).type === 'doc'
}

/**
 * Attributes from bindings. Booleans toggle the attribute; assets become paths.
 *
 * An image asset bound to `src` on an `<img>` is held back as `imageAsset` so the caller can
 * hand it to `renderImage` (which emits a full `<picture>`/`<img>` with dimensions and a
 * srcset). An image asset on any other attribute — including `src` on any other tag — is
 * resolved to its optimized `src` directly: the scaffold only copies an optimized image's
 * original bytes to `public/` when a stylesheet references it, so `publicAssetPath` would
 * otherwise point at a file that does not exist in dist.
 */
function resolveAttrs(
  attrs: Record<string, Binding> | undefined,
  scope: Scope,
  state: RenderState,
  nodeId: string,
  tag?: string,
): { attrs: AttrMap; imageAsset?: AssetRef } {
  const out: AttrMap = {}
  let imageAsset: AssetRef | undefined
  for (const [name, binding] of Object.entries(attrs ?? {})) {
    if (name === 'slot') continue
    const v = resolveBinding(state.doc, binding, scope, nodeId)
    if (v === undefined || v === false) continue
    if (v === true) {
      out[name] = true
    } else if (isAsset(v)) {
      if (name === 'src' && tag === 'img' && isOptimizedImage(v)) imageAsset = v
      else if (isOptimizedImage(v)) out[name] = state.resolveImage(v).src
      else out[name] = (state.resolveAsset ?? publicAssetPath)(v)
    } else if (isRichText(v)) {
      throw new RenderError(`attribute ${name} cannot hold rich text`, nodeId, state.page)
    } else {
      out[name] = String(v)
    }
  }
  if (state.annotateNodes) out['data-freeflow-node'] = nodeId
  const node = state.doc.nodes[nodeId]
  if (
    node &&
    Object.values(state.doc.styles).some(
      (style) => node.classes.includes(style.class) && style.property.startsWith('--ff-'),
    )
  )
    out['data-freeflow-motion'] = ''
  return imageAsset ? { attrs: out, imageAsset } : { attrs: out }
}

function renderImage(
  node: ElementNode,
  attrs: AttrMap,
  asset: AssetRef,
  state: RenderState,
): string {
  const img = state.resolveImage(asset)
  const sizes = typeof attrs.sizes === 'string' ? attrs.sizes : DEFAULT_SIZES
  const merged: AttrMap = {
    loading: 'lazy',
    decoding: 'async',
    ...attrs,
    alt: typeof attrs.alt === 'string' ? attrs.alt : (asset.alt ?? ''),
    src: img.src,
    width: String(img.width),
    height: String(img.height),
    sizes,
  }
  if (img.srcset) merged.srcset = img.srcset
  if (node.classes.length) merged.class = classAttr(state.names, node.classes)
  const imgHtml = `<img${renderAttrs(merged)}>`
  if (!img.sources?.length) return imgHtml
  const sources = img.sources
    .map((s) => `<source${renderAttrs({ type: s.type, srcset: s.srcset, sizes })}>`)
    .join('')
  return `<picture>${sources}${imgHtml}</picture>`
}

function renderElement(node: ElementNode, scope: Scope, state: RenderState): string {
  const { attrs, imageAsset } = resolveAttrs(node.attrs, scope, state, node.id, node.tag)
  if (node.tag === 'img' && imageAsset) return renderImage(node, attrs, imageAsset, state)
  if (node.classes.length) attrs.class = classAttr(state.names, node.classes)
  const open = `<${node.tag}${renderAttrs(attrs)}>`
  if (VOID_TAGS.has(node.tag)) return open
  return `${open}${renderChildren(node.children, scope, state)}</${node.tag}>`
}

function renderText(
  node: Extract<Node, { type: 'text' }>,
  scope: Scope,
  state: RenderState,
): string {
  const { attrs } = resolveAttrs(node.attrs, scope, state, node.id, node.tag)
  if (node.classes.length) attrs.class = classAttr(state.names, node.classes)
  const warn = (message: string) => state.warnings.push({ node: node.id, message })
  let inner: string
  if ('type' in node.text && node.text.type === 'doc') {
    inner = richTextInlineHtml(node.text, warn, state.doc.pages)
  } else {
    const v = resolveBinding(state.doc, node.text as Binding, scope, node.id)
    if (v === undefined || v === null) inner = ''
    else if (isRichText(v)) inner = richTextToHtml(v, warn, state.doc.pages)
    else if (isAsset(v))
      inner = escapeHtml(
        isOptimizedImage(v)
          ? state.resolveImage(v).src
          : (state.resolveAsset ?? publicAssetPath)(v),
      )
    else inner = escapeHtml(String(v))
  }
  return `<${node.tag}${renderAttrs(attrs)}>${inner}</${node.tag}>`
}

/** Group an instance's children by the slot named in their static `slot` attribute. */
function slotContent(children: readonly NodeId[], state: RenderState): Map<string, NodeId[]> {
  const slots = new Map<string, NodeId[]>()
  for (const id of children) {
    const child = getNode(state, id)
    const slotAttr = child.attrs?.slot
    const name = slotAttr?.type === 'static' ? String(slotAttr.value) : 'default'
    const list = slots.get(name) ?? []
    list.push(id)
    slots.set(name, list)
  }
  return slots
}

function renderInstance(
  node: Extract<Node, { type: 'component' }>,
  scope: Scope,
  state: RenderState,
): string {
  const component = state.doc.components[node.component]
  if (!component) throw new RenderError(`unknown component ${node.component}`, node.id, state.page)
  if (node.overrides?.length)
    state.warnings.push({
      node: node.id,
      message: 'instance overrides are not supported yet and were ignored',
    })
  const values: Record<string, unknown> = {}
  for (const [name, binding] of Object.entries(node.props ?? {})) {
    values[name] = resolveBinding(state.doc, binding, scope, node.id)
  }
  const frame: Frame = { component, values, slots: slotContent(node.children, state), outer: scope }
  const inner: Scope = { ...scope, frames: [...scope.frames, frame] }
  return renderNode(component.root, inner, state)
}

function renderSlot(
  node: Extract<Node, { type: 'slot' }>,
  scope: Scope,
  state: RenderState,
): string {
  const frame = scope.frames[scope.frames.length - 1]
  if (!frame) throw new RenderError('slot outside a component', node.id, state.page)
  const content = frame.slots.get(node.name)
  if (content?.length) return renderChildren(content, frame.outer, state)
  return renderChildren(node.children, scope, state)
}

function renderList(
  node: Extract<Node, { type: 'collection-list' }>,
  scope: Scope,
  state: RenderState,
): string {
  const collection = state.doc.collections[node.collection]
  if (!collection)
    throw new RenderError(`unknown collection ${node.collection}`, node.id, state.page)
  const { attrs } = resolveAttrs(node.attrs, scope, state, node.id, node.tag)
  if (node.classes.length) attrs.class = classAttr(state.names, node.classes)
  const entries = applyQuery(state.doc.entries[node.collection] ?? [], node.query)
  const items = entries
    .map((entry) => renderChildren(node.children, { ...scope, entry, collection }, state))
    .join('')
  return `<${node.tag}${renderAttrs(attrs)}>${items}</${node.tag}>`
}

export function renderChildren(ids: readonly NodeId[], scope: Scope, state: RenderState): string {
  return ids.map((id) => renderNode(id, scope, state)).join('')
}

export function renderNode(id: NodeId, scope: Scope, state: RenderState): string {
  const node = getNode(state, id)
  checkClasses(node, state)
  switch (node.type) {
    case 'element':
      return renderElement(node, scope, state)
    case 'text':
      return renderText(node, scope, state)
    case 'component':
      return renderInstance(node, scope, state)
    case 'slot':
      return renderSlot(node, scope, state)
    case 'collection-list':
      return renderList(node, scope, state)
    case 'embed':
      return node.html
    case 'code-component':
      throw new RenderError('code components are not supported yet', node.id, state.page)
  }
}
