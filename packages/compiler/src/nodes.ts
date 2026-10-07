import { type ClassNames, classAttr, iconSvg, isMotionStyle, wordTurns } from '@lacuno/css'
import {
  type AssetRef,
  type Binding,
  type Document,
  type ElementNode,
  type FieldToken,
  type Node,
  type NodeId,
  plainText,
  type RichText,
  type RotatingWords,
  type TextNode,
} from '@lacuno/schema'
import { isImage } from './assets.js'
import { RenderError } from './errors.js'
import { formFields } from './forms.js'
import { type AttrMap, escapeHtml, renderAttrs, VOID_TAGS } from './html.js'
import type { ImageResolver } from './images.js'
import { applyQuery } from './query.js'
import { richTextInlineHtml, richTextToHtml } from './richtext.js'
import { listPagePath, listPages } from './routes.js'
import type { Frame } from './scope.js'
import { type Resolved, resolveBinding, type Scope } from './scope.js'

export type Warning = { node: string; message: string }

export type RenderState = {
  doc: Document
  names: ClassNames
  resolveImage: ImageResolver
  resolveAsset: (asset: AssetRef) => string
  /** Class ids carrying a motion custom property, see `motionClasses`. */
  motion: ReadonlySet<string>
  page: string
  warnings: Warning[]
  annotateNodes?: boolean
  editingComponent?: string
  /** The page of the paginated list being rendered, 1 when left out. */
  listPage?: number
  /** Collects each rendered text node's content, for a plain-text view of the page. */
  texts?: [NodeId, Resolved][]
  /** Set once the page has a Lacuno form, which needs `FORM_SCRIPT`. */
  forms?: true
}

/** The classes that carry a Motion field, gathered once so marking a node is a set lookup. */
export function motionClasses(doc: Document): ReadonlySet<string> {
  return new Set(
    Object.values(doc.styles)
      .filter(isMotionStyle)
      .map((style) => style.class),
  )
}

const DEFAULT_SIZES = '100vw'

function getNode(state: RenderState, id: NodeId): Node {
  const node = state.doc.nodes[id]
  if (!node) throw new RenderError(`unknown node ${id}`, id, state.page)
  return node
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
    const v = resolveBinding(state.doc, binding, scope, nodeId, name)
    if (v === undefined || v === false) continue
    if (v === true) {
      out[name] = true
    } else if (isAsset(v)) {
      if (name === 'src' && tag === 'img' && isImage(v)) imageAsset = v
      else if (isImage(v)) out[name] = state.resolveImage(v).src
      else out[name] = state.resolveAsset(v)
    } else if (isRichText(v)) {
      throw new RenderError(`attribute ${name} cannot hold rich text`, nodeId, state.page)
    } else {
      out[name] = String(v)
    }
  }
  if (state.annotateNodes) {
    const frame = scope.frames.find(
      (frame) => frame.instance && frame.component.id !== state.editingComponent,
    )
    if (!frame) out['data-lacuno-node'] = nodeId
    else {
      // Alias components have another instance as their root; annotate the rendered root.
      let root = frame.component.root
      const seen = new Set<string>()
      while (!seen.has(root)) {
        seen.add(root)
        const node = state.doc.nodes[root]
        if (node?.type !== 'component') break
        root = state.doc.components[node.component]!.root
      }
      if (root === nodeId) out['data-lacuno-node'] = frame.instance
    }
  }
  const node = state.doc.nodes[nodeId]
  if (node?.classes.some((c) => state.motion.has(c))) out['data-lacuno-motion'] = ''
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
    sizes,
  }
  // A size is only known for images measured on import; 0 would collapse the element.
  if (img.width) merged.width = String(img.width)
  if (img.height) merged.height = String(img.height)
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
  // A form without its own action is a Lacuno form: published, it posts to the site's endpoint.
  const form = node.tag === 'form' && attrs.action === undefined && !state.annotateNodes
  if (form) {
    attrs.action = '/_lacuno/forms'
    attrs.method = 'post'
    state.forms = true
  }
  const open = `<${node.tag}${renderAttrs(attrs)}>`
  if (VOID_TAGS.has(node.tag)) return open
  const name = attrs['data-lacuno-form']
  return `${open}${renderChildren(node.children, scope, state)}${
    form ? formFields(typeof name === 'string' && name ? name : 'Contact form') : ''
  }</${node.tag}>`
}

/** A text's content: rich text written on it, or its binding resolved. */
function textContent(node: TextNode, scope: Scope, state: RenderState): Resolved {
  return node.text.type === 'doc' ? node.text : resolveBinding(state.doc, node.text, scope, node.id)
}

function renderText(node: TextNode, scope: Scope, state: RenderState): string {
  const { attrs } = resolveAttrs(node.attrs, scope, state, node.id, node.tag)
  if (node.classes.length) attrs.class = classAttr(state.names, node.classes)
  const warn = (message: string) => state.warnings.push({ node: node.id, message })
  const v = textContent(node, scope, state)
  state.texts?.push([node.id, v])
  let inner: string
  if (v === undefined || v === null) inner = ''
  // Rich text written on the node renders inline; bound rich text keeps its blocks.
  else if (isRichText(v)) {
    // Fields inside written text read the entry around the node, or the one they name.
    const field = (token: FieldToken) => {
      const value = resolveBinding(state.doc, { type: 'field', ...token }, scope, node.id)
      return isRichText(value) ? plainText(value) : isAsset(value) ? '' : String(value ?? '')
    }
    inner =
      v === node.text
        ? richTextInlineHtml(v, warn, state.doc.pages, field)
        : richTextToHtml(v, warn, state.doc.pages)
    // The canvas selects the tags inside blocks one by one, to style them per class.
    const blocks = v !== node.text || v.content?.length !== 1 || v.content[0]?.type !== 'paragraph'
    if (state.annotateNodes && blocks && v.content?.length) attrs['data-lacuno-rich'] = true
  } else if (isAsset(v))
    inner = escapeHtml(isImage(v) ? state.resolveImage(v).src : state.resolveAsset(v))
  else inner = escapeHtml(String(v))
  if (node.rotatingWords) inner = rotatingWords(node, node.rotatingWords, inner, scope, state)
  return `<${node.tag}${renderAttrs(attrs)}>${inner}</${node.tag}>`
}

/**
 * The content as the first of the rotating words, each with its icon and a word shown several
 * turns in a row as one element. The list is hidden from assistive tech, which reads visually
 * hidden text after it instead: every turn once, "AI, designer, you".
 */
function rotatingWords(
  node: TextNode,
  words: RotatingWords,
  first: string,
  scope: Scope,
  state: RenderState,
): string {
  const turns = wordTurns(node, words)
  if (turns.length < 2) return first
  const attrs: AttrMap = { 'aria-hidden': 'true', 'data-lc-words': String(words.words.length + 1) }
  if (words.transition === 'fade') attrs['data-lc-fade'] = true
  if (words.interval !== undefined) attrs.style = `--lc-interval:${words.interval}ms`
  const list = turns.map(({ text, icon, at, slots }) => {
    const turn: AttrMap = {}
    if (at) turn['data-lc-at'] = String(at)
    if (slots > 1) turn['data-lc-slots'] = String(slots)
    return `<span${renderAttrs(turn)}>${icon ? iconSvg(icon) : ''}${at ? escapeHtml(text ?? '') : first}</span>`
  })
  return `<span${renderAttrs(attrs)}>${list.join('')}</span>${said(node, words, scope, state)}`
}

/**
 * What a screen reader hears for rotating words. Rotating texts right next to each other that
 * turn in step (as many words, the same interval) read as one phrase per turn, from the last of
 * them: "your " and "‹AI›" become "your AI, your designer, you".
 */
function said(node: TextNode, words: RotatingWords, scope: Scope, state: RenderState): string {
  const siblings = node.parent ? getNode(state, node.parent).children : [node.id]
  const index = siblings.indexOf(node.id)
  const inStep = (id: NodeId | undefined) => {
    const other = id === undefined ? undefined : state.doc.nodes[id]
    const rotating = other?.type === 'text' ? other.rotatingWords : undefined
    return rotating?.words.length === words.words.length &&
      (rotating.interval ?? 2200) === (words.interval ?? 2200)
      ? (other as TextNode)
      : undefined
  }
  if (inStep(siblings[index + 1])) return ''
  const group = [node]
  for (let i = index - 1, other = inStep(siblings[i]); other; other = inStep(siblings[--i]))
    group.unshift(other)
  const phrases = Array.from({ length: words.words.length + 1 }, (_, turn) =>
    group
      .map((member) => {
        if (turn) {
          const word = member.rotatingWords!.words[turn - 1]!
          return typeof word === 'string' ? word : word.text
        }
        const v = textContent(member, scope, state)
        return isRichText(v) ? plainText(v) : isAsset(v) ? '' : String(v ?? '')
      })
      .join('')
      .trim(),
  )
  return `<span data-lc-said>${escapeHtml(phrases.filter(Boolean).join(', '))}</span>`
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
  // parseDocument has already checked every component, collection and class reference.
  const component = state.doc.components[node.component]!
  if (node.overrides?.length)
    state.warnings.push({
      node: node.id,
      message: 'instance overrides are not supported yet and were ignored',
    })
  const values: Record<string, unknown> = {}
  for (const [name, binding] of Object.entries(node.props ?? {})) {
    values[name] = resolveBinding(state.doc, binding, scope, node.id)
  }
  const frame: Frame = {
    instance: node.id,
    component,
    values,
    slots: slotContent(node.children, state),
    outer: scope,
  }
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
  const collection = state.doc.collections[node.collection]!
  const { attrs } = resolveAttrs(node.attrs, scope, state, node.id, node.tag)
  if (node.classes.length) attrs.class = classAttr(state.names, node.classes)
  const listPage = node.query?.paginate ? (state.listPage ?? 1) : 1
  const query =
    listPage > 1 && node.query?.limit
      ? { ...node.query, offset: (node.query.offset ?? 0) + (listPage - 1) * node.query.limit }
      : node.query
  const entries = applyQuery(state.doc.entries[node.collection] ?? [], query)
  const items = entries
    .map((entry) => renderChildren(node.children, { ...scope, entry, collection }, state))
    .join('')
  const list = `<${node.tag}${renderAttrs(attrs)}>${items}</${node.tag}>`
  return node.query?.paginate ? list + pagination(node, listPage, state) : list
}

/**
 * Previous and next links after a paginated list, with where the reader is: "Page 2 of 5".
 * Nothing when everything fits on one page.
 */
function pagination(
  node: Extract<Node, { type: 'collection-list' }>,
  current: number,
  state: RenderState,
): string {
  const pages = listPages(state.doc, node)
  if (pages < 2) return ''
  const path = state.doc.pages[state.page]!.path
  const link = (n: number, rel: string, text: string) =>
    `<a${renderAttrs({ href: listPagePath(path, n), rel })}>${text}</a>`
  return `<nav${renderAttrs({ class: 'lc-pagination', 'aria-label': 'Pagination' })}>${
    current > 1 ? link(current - 1, 'prev', '← Previous') : ''
  }<span>Page ${current} of ${pages}</span>${
    current < pages ? link(current + 1, 'next', 'Next →') : ''
  }</nav>`
}

export function renderChildren(ids: readonly NodeId[], scope: Scope, state: RenderState): string {
  return ids.map((id) => renderNode(id, scope, state)).join('')
}

export function renderNode(id: NodeId, scope: Scope, state: RenderState): string {
  const node = getNode(state, id)
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
    case 'embed': {
      // An embed with classes or attributes publishes in a wrapper that carries them; the canvas
      // always wraps it so it can be selected and sized. Otherwise the markup goes out as it is.
      const { attrs } = resolveAttrs(node.attrs, scope, state, node.id)
      if (node.classes.length) attrs.class = classAttr(state.names, node.classes)
      if (state.annotateNodes) attrs['data-lacuno-embed'] = true
      if (!Object.keys(attrs).length) return node.html
      return `<div${renderAttrs(attrs)}>${node.html}</div>`
    }
    case 'code-component':
      throw new RenderError('code components are not supported yet', node.id, state.page)
  }
}
