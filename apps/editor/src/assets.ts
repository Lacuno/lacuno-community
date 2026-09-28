import { nodesUsingClass, referencesToAsset } from '@lacuno/document/references'
import type { AssetRef, Document } from '@lacuno/schema'
import { uses as describeUses } from './cms.js'
import { faceLabel } from './fonts.js'
import { nodeLabel } from './structure.js'

/** One place an asset is used. `node` is the element to select for it, when there is one. */
export type AssetUse = { label: string; place: string; node?: string }

/** The page or component definition a node belongs to. */
export function nodeHome(doc: Document, id: string) {
  let root = id
  while (doc.nodes[root]?.parent) root = doc.nodes[root]!.parent!
  return {
    page: Object.values(doc.pages).find((page) => page.root === root),
    component: Object.values(doc.components).find((component) => component.root === root),
  }
}

export function nodeUse(doc: Document, id: string, detail = ''): AssetUse {
  const { page, component } = nodeHome(doc, id)
  return {
    label: `${nodeLabel(doc.nodes[id]!)}${detail}`,
    place: page?.name ?? (component ? `${component.name} component` : ''),
    node: id,
  }
}

/**
 * Where an asset is used, as people read it: elements (their bindings and the styles of their
 * classes), design tokens, site fonts, the favicon and pages' social images. Empty when unused.
 */
export function assetUses(doc: Document, id: string): AssetUse[] {
  const uses = referencesToAsset(doc, id).flatMap((ref): AssetUse[] => {
    const [kind, key = ''] = ref.split('.')
    if (kind === 'nodes') return [nodeUse(doc, key)]
    if (kind === 'styles') {
      const decl = doc.styles[key]!
      const style = doc.classes[decl.class]
      const detail = ` · ${style?.kind === 'class' ? `.${style.name} ` : ''}${decl.property}`
      const nodes = nodesUsingClass(doc, decl.class)
      return nodes.length
        ? nodes.map((node) => nodeUse(doc, node, detail))
        : [{ label: `.${style?.name ?? decl.class} · ${decl.property}`, place: 'Unused class' }]
    }
    if (kind === 'designTokens')
      return [{ label: doc.designTokens[key]?.name ?? key, place: 'Design tokens' }]
    if (kind === 'entries') return describeUses(doc, [ref])
    if (ref === 'site.favicon') return [{ label: 'Favicon', place: 'Site settings' }]
    if (ref.startsWith('site.fonts.')) {
      const font = doc.site.fonts[Number(ref.split('.')[2])]!
      return [{ label: `${font.family} ${faceLabel(font)}`, place: 'Site fonts' }]
    }
    return [{ label: 'Social image', place: doc.pages[key]?.name ?? key }]
  })
  // Several breakpoints or states of one element's styles read as one use.
  return uses.filter(
    (use, index) =>
      uses.findIndex((other) => other.label === use.label && other.node === use.node) === index,
  )
}

export type AssetSort = 'newest' | 'name' | 'size'

/** The assets whose name contains `search`, newest (last uploaded) first, by name or largest first. */
export function listAssets(doc: Document, search: string, sort: AssetSort): AssetRef[] {
  const query = search.trim().toLowerCase()
  const assets = Object.values(doc.assets).filter((asset) =>
    asset.name.toLowerCase().includes(query),
  )
  if (sort === 'newest') return assets.reverse()
  return assets.sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true }) : b.size - a.size,
  )
}

/** "340 KB", "2.4 MB". */
export function fileSize(bytes: number) {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1000 * 1000) return `${Math.round(bytes / 1000)} KB`
  return `${(bytes / 1000 / 1000).toFixed(1)} MB`
}

/** What people call the asset's type: "PNG image", "SVG", "WOFF2 font", "MP4 video", "PDF". */
export function assetType(asset: AssetRef) {
  const format = (asset.mime.split('/')[1] ?? asset.kind)
    .replace('svg+xml', 'svg')
    .replace('jpeg', 'jpg')
    .toUpperCase()
  if (asset.kind === 'image') return `${format} image`
  if (asset.kind === 'video') return `${format} video`
  if (asset.kind === 'font') return `${format} font`
  return format
}
