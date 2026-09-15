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
import { richTextInlineHtml, richTextToHtml } from './richtext.js'
import { type Resolved, resolveBinding, type Scope } from './scope.js'

export type Warning = { node: string; message: string }

export type RenderState = {
  doc: Document
  names: ClassNames
  resolveImage: ImageResolver
  page: string
  warnings: Warning[]
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

/** Attributes from bindings. Booleans toggle the attribute; assets become paths. */
function resolveAttrs(
  attrs: Record<string, Binding> | undefined,
  scope: Scope,
  state: RenderState,
  nodeId: string,
): { attrs: AttrMap; imageAsset?: AssetRef } {
  const out: AttrMap = {}
  let imageAsset: AssetRef | undefined
  for (const [name, binding] of Object.entries(attrs ?? {})) {
    const v = resolveBinding(state.doc, binding, scope, nodeId)
    if (v === undefined || v === false) continue
    if (v === true) {
      out[name] = true
    } else if (isAsset(v)) {
      if (name === 'src' && isOptimizedImage(v)) imageAsset = v
      else out[name] = publicAssetPath(v)
    } else if (isRichText(v)) {
      throw new RenderError(`attribute ${name} cannot hold rich text`, nodeId, state.page)
    } else {
      out[name] = String(v)
    }
  }
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
  const { attrs, imageAsset } = resolveAttrs(node.attrs, scope, state, node.id)
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
  const { attrs } = resolveAttrs(node.attrs, scope, state, node.id)
  if (node.classes.length) attrs.class = classAttr(state.names, node.classes)
  const warn = (message: string) => state.warnings.push({ node: node.id, message })
  let inner: string
  if ('type' in node.text && node.text.type === 'doc') {
    inner = richTextInlineHtml(node.text, warn)
  } else {
    const v = resolveBinding(state.doc, node.text as Binding, scope, node.id)
    if (v === undefined || v === null) inner = ''
    else if (isRichText(v)) inner = richTextToHtml(v, warn)
    else if (isAsset(v)) inner = escapeHtml(publicAssetPath(v))
    else inner = escapeHtml(String(v))
  }
  return `<${node.tag}${renderAttrs(attrs)}>${inner}</${node.tag}>`
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
    case 'code-component':
      throw new RenderError('code components are not supported yet', node.id, state.page)
    default:
      throw new RenderError(`node type ${node.type} is not implemented`, node.id, state.page)
  }
}
