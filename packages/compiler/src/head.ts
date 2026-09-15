import type { Document, Font, Page } from '@freeflow/schema'
import { extensionForMime, publicAssetPath } from './assets.js'
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

function googleFontsHref(fonts: Font[]): string {
  const families = fonts.map((f) => {
    const family = f.family.replace(/ /g, '+')
    const weights = f.weights?.length
      ? `:wght@${[...f.weights].sort((a, b) => a - b).join(';')}`
      : ''
    return `family=${family}${weights}`
  })
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`
}

function renderFonts(doc: Document, page: Page): string[] {
  const out: string[] = []
  const google = doc.site.fonts.filter((f) => f.source === 'google')
  if (google.length) {
    out.push('<link rel="preconnect" href="https://fonts.googleapis.com">')
    out.push('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>')
    out.push(`<link rel="stylesheet" href="${escapeAttr(googleFontsHref(google))}">`)
  }
  const faces: string[] = []
  for (const f of doc.site.fonts) {
    if (f.source !== 'asset') continue
    const asset = f.asset ? doc.assets[f.asset] : undefined
    if (!asset) throw new RenderError(`font ${f.family} has no known asset`, undefined, page.id)
    const href = publicAssetPath(asset)
    const ext = extensionForMime(asset.mime)
    const format = FONT_FORMAT[ext] ?? ext
    out.push(
      `<link rel="preload" as="font" type="${escapeAttr(asset.mime)}" href="${escapeAttr(href)}" crossorigin>`,
    )
    faces.push(
      `@font-face{font-family:"${f.family}";src:url("${href}") format("${format}");font-display:swap}`,
    )
  }
  if (faces.length) out.push(`<style>${faces.join('')}</style>`)
  return out
}

export function renderHead(input: HeadInput): string {
  const { doc, page, path } = input
  const siteUrl = input.siteUrl ? input.siteUrl.replace(/\/+$/, '') : undefined
  const seo = page.seo
  const title = seo?.title ?? page.name
  const absolute = (p: string) => (siteUrl ? `${siteUrl}${p}` : p)
  const parts: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
  ]
  if (seo?.description) parts.push(meta('description', seo.description))
  if (seo?.noindex) parts.push(meta('robots', 'noindex'))
  const canonical = seo?.canonical ?? (siteUrl ? absolute(path) : undefined)
  if (canonical) parts.push(`<link rel="canonical" href="${escapeAttr(canonical)}">`)
  parts.push(og('og:type', 'website'))
  parts.push(og('og:title', title))
  parts.push(og('og:site_name', doc.site.name))
  if (seo?.description) parts.push(og('og:description', seo.description))
  if (siteUrl) parts.push(og('og:url', absolute(path)))
  if (seo?.ogImage) {
    const asset = doc.assets[seo.ogImage]
    if (!asset) throw new RenderError(`unknown og image ${seo.ogImage}`, undefined, page.id)
    const src = asset.kind === 'image' ? input.resolveImage(asset).src : publicAssetPath(asset)
    parts.push(og('og:image', absolute(src)))
  }
  parts.push(...renderFonts(doc, page))
  if (doc.site.headCode) parts.push(doc.site.headCode)
  if (page.headCode) parts.push(page.headCode)
  return parts.join('\n')
}
