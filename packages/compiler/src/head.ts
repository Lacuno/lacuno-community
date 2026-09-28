import {
  type AssetRef,
  type Document,
  type Entry,
  findEntry,
  type Page,
  pageLang,
  plainText,
} from '@lacuno/schema'
import { extensionForMime, isImage, publicAssetPath } from './assets.js'
import { RenderError } from './errors.js'
import { escapeAttr, escapeHtml } from './html.js'
import type { ImageResolver } from './images.js'

export type HeadInput = {
  doc: Document
  page: Page
  /** Output path of this route, e.g. `/blog/hello`. */
  path: string
  /** Public base URL without trailing slash. Enables canonical, og:url and absolute og:image. */
  siteUrl?: string
  resolveImage: ImageResolver
  resolveAsset?: (asset: AssetRef) => string
  /** A collection page's entry, whose fields may give the title, description and image. */
  entry?: Entry
}

const FONT_FORMAT: Record<string, string> = {
  woff2: 'woff2',
  woff: 'woff',
  ttf: 'truetype',
  otf: 'opentype',
}

function meta(name: string, content: string): string {
  return `<meta name="${escapeAttr(name)}" content="${escapeAttr(content)}">`
}

function og(property: string, content: string): string {
  return `<meta property="${escapeAttr(property)}" content="${escapeAttr(content)}">`
}

/**
 * Escapes a font family name for use inside a double-quoted CSS string embedded in a `<style>`
 * element: backslash-escapes `\` and `"`, and neutralizes `<` (as the CSS escape `\3c `) so a
 * family name cannot break out of the string or close the surrounding `<style>` tag.
 */
function cssString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3c ')
}

/**
 * Asset fonts get a font-face rule per face and one preload per family, for its regular face
 * (normal, with weight 400 or a weight range containing 400) or else its first. System fonts
 * need nothing. No third parties.
 */
function renderFonts(
  doc: Document,
  page: Page,
  resolveAsset: (asset: AssetRef) => string,
): string[] {
  const preloads = new Map<string, { regular: boolean; link: string }>()
  const faces: string[] = []
  for (const f of doc.site.fonts) {
    if (f.source !== 'asset') continue
    const asset = f.asset ? doc.assets[f.asset] : undefined
    if (!asset) throw new RenderError(`font ${f.family} has no known asset`, undefined, page.id)
    const href = resolveAsset(asset)
    const ext = extensionForMime(asset.mime)
    const format = FONT_FORMAT[ext] ?? ext
    const [min, max] = f.weightRange ?? [f.weight ?? 400, f.weight ?? 400]
    const weight = min === max ? min : `${min} ${max}`
    const style = f.style ?? 'normal'
    const regular = min <= 400 && max >= 400 && style === 'normal'
    const seen = preloads.get(f.family)
    if (!seen || (regular && !seen.regular))
      preloads.set(f.family, {
        regular,
        link: `<link rel="preload" as="font" type="${escapeAttr(asset.mime)}" href="${escapeAttr(href)}" crossorigin>`,
      })
    faces.push(
      `@font-face{font-family:"${cssString(f.family)}";src:url("${href}") format("${format}");font-weight:${weight};font-style:${style};font-display:swap}`,
    )
  }
  const out = [...preloads.values()].map((p) => p.link)
  if (faces.length) out.push(`<style>${faces.join('')}</style>`)
  return out
}

export function renderHead(input: HeadInput): string {
  const { doc, page, path } = input
  const resolveAsset = input.resolveAsset ?? publicAssetPath
  const siteUrl = input.siteUrl ? input.siteUrl.replace(/\/+$/, '') : undefined
  // Entry fields named in seo.fields stand in for the page's own values: of the collection page's
  // entry, else of the chosen one.
  const entry = input.entry ?? (page.seo?.entry ? findEntry(doc, page.seo.entry)?.entry : undefined)
  const fromEntry = (key: 'title' | 'description' | 'ogImage') => {
    const field = page.seo?.fields?.[key]
    const value = field ? entry?.fields[field] : undefined
    if (value === undefined) return undefined
    return typeof value === 'object' ? plainText(value) : String(value)
  }
  const seo = {
    ...page.seo,
    ...Object.fromEntries(
      (['title', 'description', 'ogImage'] as const)
        .map((key) => [key, fromEntry(key)])
        .filter(([, value]) => value),
    ),
  }
  const title = seo.title ?? page.name
  const absolute = (p: string) => (siteUrl ? `${siteUrl}${p}` : p)
  const parts: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
  ]
  if (seo.description) parts.push(meta('description', seo.description))
  if (seo.noindex) parts.push(meta('robots', 'noindex'))
  const canonical = seo.canonical ?? (siteUrl ? absolute(path) : undefined)
  if (canonical) parts.push(`<link rel="canonical" href="${escapeAttr(canonical)}">`)
  const favicon = doc.site.favicon ? doc.assets[doc.site.favicon] : undefined
  if (favicon)
    parts.push(
      `<link rel="icon" type="${escapeAttr(favicon.mime)}" href="${escapeAttr(resolveAsset(favicon))}">`,
    )
  parts.push(og('og:type', 'website'))
  parts.push(og('og:title', title))
  parts.push(og('og:site_name', doc.site.name))
  // Open Graph wants language_TERRITORY (`en_US`); a bare language has no valid form.
  const locale = pageLang(doc, page).match(/^([a-z]{2,3})(?:-\w+)*-([a-z]{2})$/i)
  if (locale) parts.push(og('og:locale', `${locale[1]}_${locale[2]!.toUpperCase()}`))
  if (seo.description) parts.push(og('og:description', seo.description))
  if (siteUrl) parts.push(og('og:url', absolute(path)))
  if (seo.ogImage) {
    const asset = doc.assets[seo.ogImage]
    if (!asset) throw new RenderError(`unknown og image ${seo.ogImage}`, undefined, page.id)
    const src = isImage(asset) ? input.resolveImage(asset).src : resolveAsset(asset)
    parts.push(og('og:image', absolute(src)))
  }
  parts.push(meta('twitter:card', seo.ogImage ? 'summary_large_image' : 'summary'))
  parts.push(...renderFonts(doc, page, resolveAsset))
  if (doc.site.headCode) parts.push(doc.site.headCode)
  if (page.headCode) parts.push(page.headCode)
  return parts.join('\n')
}
