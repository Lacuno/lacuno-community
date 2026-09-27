import type { Document } from '@lacuno/schema'
import { useEffect, useRef } from 'react'
import { api } from './api.js'
import type { Preview } from './usePreview.js'

/** The first screen of the page at desktop width, drawn at half size: 640×400 pixels. */
const VIEWPORT = { width: 1280, height: 800 }

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

const encode = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.8))

/**
 * Draws a canvas render as an image in the browser: the page goes into an SVG `foreignObject`,
 * which a canvas draws like any image. An SVG image loads nothing, so the site's own assets (its
 * only ones: the render allows no others) are inlined first. WebP, or JPEG where the browser
 * cannot encode WebP.
 */
export async function drawThumbnail(html: string) {
  const urls = new Set(html.match(/\/api\/sites\/[^/"'()\s]+\/assets\/[a-f0-9]{64}/g))
  for (const url of urls)
    html = html.replaceAll(url, await dataUrl(await (await fetch(url)).blob()))
  const page = new DOMParser().parseFromString(html, 'text/html')
  for (const element of page.querySelectorAll('meta[http-equiv], link, script')) element.remove()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEWPORT.width}" height="${VIEWPORT.height}"><foreignObject width="100%" height="100%">${new XMLSerializer().serializeToString(page.documentElement)}</foreignObject></svg>`
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = VIEWPORT.width / 2
  canvas.height = VIEWPORT.height / 2
  const context = canvas.getContext('2d')!
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const webp = await encode(canvas, 'image/webp')
  const blob = webp?.type === 'image/webp' ? webp : await encode(canvas, 'image/jpeg')
  if (!blob) throw new Error('The thumbnail could not be encoded')
  return blob
}

/**
 * Keeps the site's thumbnail, its home page's first screen, as current as the document: ten seconds
 * after an edit settles, and when the editor closes with a newer revision than the last one drawn.
 * It is drawn here because only a browser can draw it; the server keeps it for the site list.
 */
export function useThumbnail(siteId: string, doc: Document | undefined, enabled: boolean) {
  const drawn = useRef<number>(undefined)
  const latest = useRef({ doc, enabled })
  latest.current = { doc, enabled }
  const refresh = useRef(async () => {
    const { doc, enabled } = latest.current
    if (!enabled || !doc || drawn.current === doc.revision) return
    const pages = Object.values(doc.pages)
    const home = pages.find((page) => page.path === '/') ?? pages[0]
    if (!home) return
    drawn.current = doc.revision
    try {
      const { html, revision } = await api<Preview>(
        `/api/sites/${siteId}/preview?page=${encodeURIComponent(home.id)}`,
      )
      const image = (await dataUrl(await drawThumbnail(html))).split(',')[1]
      await api(`/api/sites/${siteId}/thumbnail`, { revision, image })
      window.dispatchEvent(new CustomEvent('lacuno:thumbnail', { detail: siteId }))
    } catch {
      // Only a preview: the next edit or close draws it again.
      drawn.current = undefined
    }
  })
  useEffect(() => {
    if (doc?.revision === undefined) return
    const timer = setTimeout(() => void refresh.current(), 10_000)
    return () => clearTimeout(timer)
  }, [doc?.revision])
  useEffect(() => () => void refresh.current(), [])
}
