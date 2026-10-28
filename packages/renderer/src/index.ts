import { enumerateRoutes, IMAGE_WIDTHS, type RenderContext } from '@lacuno/compiler'
import { assembleDocument, render } from '@lacuno/compiler/render'
import { generateStylesheet, styleElement } from '@lacuno/css'
import { type AssetRef, type Document, type Entry, type Page, siteLocales } from '@lacuno/schema'

export type CanvasResult = { html: string; warnings: { node: string; message: string }[] }

/**
 * An asset's bytes on the editor's API; with `width`, an image whose size is known as a WebP
 * that wide (the server serves the original where it cannot resize).
 */
/** Spike: an editor on another origin names the runtime, so the canvas asks it, not itself. */
export let assetOrigin = ''
export const setAssetOrigin = (origin: string) => {
  assetOrigin = origin
}
export const assetUrl = (siteId: string, asset: AssetRef, width?: number) =>
  `${assetOrigin}/api/sites/${encodeURIComponent(siteId)}/assets/${asset.hash}${
    width && asset.width ? `?w=${width}` : ''
  }`

/**
 * The canvas's sources for an image: the original, and with it the variants below its width when
 * there are any. An image whose size is unknown, or too small to shrink, has the original alone.
 * The canvas cannot know how wide an image lays out, so `sizes` leaves the choice to the browser:
 * `auto` picks the variant for the rendered width of a lazily loaded image (a thumbnail its 320,
 * a hero still the original), and a browser without it takes the whole canvas as it did before.
 */
export function canvasImage(
  siteId: string,
  asset: AssetRef,
): { src: string; srcset: string; sizes: string } {
  const src = assetUrl(siteId, asset)
  const sizes = 'auto, 100vw'
  const variants = IMAGE_WIDTHS.filter((w) => w < (asset.width ?? 0)).map(
    (w) => `${assetUrl(siteId, asset, w)} ${w}w`,
  )
  if (!variants.length) return { src, srcset: '', sizes }
  return { src, srcset: [...variants, `${src} ${asset.width}w`].join(', '), sizes }
}

/** Assets as the editor's API serves them, for the canvas and the site preview. */
const editorAssets = (siteId: string): Pick<RenderContext, 'resolveAsset' | 'resolveImage'> => ({
  resolveAsset: (asset) => assetUrl(siteId, asset),
  resolveImage: (asset) => ({
    ...canvasImage(siteId, asset),
    width: asset.width ?? 0,
    height: asset.height ?? 0,
  }),
})

/** The canvas uses the compiler's DOM and CSS, with selection metadata and the editor's asset URLs. */
export function renderCanvas(
  doc: Document,
  page: Page,
  entry: Entry | undefined,
  siteId: string,
  editingComponent?: string,
  locale?: string,
): CanvasResult {
  if (editingComponent) {
    const component = doc.components[editingComponent]
    if (!component) throw new Error('Component not found')
    // Synthetic wrapper nodes for the canvas only; fixed ids keep the output deterministic.
    const body = 'n-editing-body'
    const instance = 'n-editing-instance'
    doc = {
      ...doc,
      nodes: {
        ...doc.nodes,
        [body]: {
          id: body,
          type: 'element',
          tag: 'body',
          parent: null,
          children: [instance],
          classes: [...doc.nodes[page.root]!.classes],
          ...(doc.nodes[page.root]!.attrs ? { attrs: doc.nodes[page.root]!.attrs } : {}),
        },
        [instance]: {
          id: instance,
          type: 'component',
          component: component.id,
          parent: body,
          children: [],
          classes: [],
        },
      },
    }
    page = { ...page, root: body }
  }
  const result = render(doc, page, entry, {
    annotateNodes: true,
    ...(editingComponent ? { editingComponent } : {}),
    ...(locale ? { locale } : {}),
    ...editorAssets(siteId),
  })
  // Only the canvas emits the forced state selectors the editor's state picker switches on.
  const { css } = generateStylesheet(doc, {
    assetUrl: (asset) => assetUrl(siteId, asset),
    previewStates: true,
  })
  // A second barrier in addition to the iframe sandbox: site code cannot execute, submit forms,
  // change the base URL, or load another frame in the editor's authenticated origin.
  const policy =
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'"
  // Scroll motion holds still while editing, so every element sits at rest and can be selected.
  result.htmlAttrs['data-lacuno-still'] = ''
  result.head = `<meta http-equiv="Content-Security-Policy" content="${policy}">\n${result.head}\n${styleElement(css)}`
  return { html: assembleDocument(result), warnings: result.warnings }
}

/** The editor's preview route: a page, entry, component or language the document lacks is an error. */
export function renderPreview(
  doc: Document,
  siteId: string,
  query: { page?: string; entry?: string; component?: string; locale?: string },
):
  | { status: 200; body: CanvasResult & { revision: number } }
  | { status: 400 | 404; body: { error: string } } {
  const page = doc.pages[query.page ?? '']
  if (!page) return { status: 404, body: { error: 'Page not found' } }
  // A collection without entries yet previews its page with every field empty.
  const entries = page.collection ? (doc.entries[page.collection] ?? []) : []
  const entry = page.collection
    ? (entries.find((item) => item.id === query.entry) ??
      (entries.length ? undefined : { id: '', fields: {} }))
    : undefined
  if (page.collection && !entry)
    return { status: 400, body: { error: 'Choose a collection entry to preview' } }
  if (query.component && !doc.components[query.component])
    return { status: 404, body: { error: 'Component not found' } }
  if (query.locale && !siteLocales(doc).some((l) => l.code === query.locale))
    return { status: 404, body: { error: 'Language not found' } }
  return {
    status: 200,
    body: {
      ...renderCanvas(doc, page, entry, siteId, query.component, query.locale),
      revision: doc.revision,
    },
  }
}

/**
 * The site preview's frame runs the site's scripts with an origin of its own, so it cannot reach
 * the editor: it hands a click on one of the site's own links, and a form's submit, to the editor.
 */
const PREVIEW_SCRIPT = `<script>
addEventListener('click', (event) => {
  const link = event.target.closest?.('a[href]')
  const href = link?.getAttribute('href')
  if (!href || href.startsWith('#') || event.defaultPrevented) return
  event.preventDefault()
  if (/^\\/(?!\\/)/.test(href)) parent.postMessage({ lacunoPreview: href.split(/[?#]/)[0] }, '*')
  else open(link.href, '_blank', 'noopener')
})
addEventListener('submit', (event) => {
  event.preventDefault()
  event.stopImmediatePropagation()
  parent.postMessage({ lacunoPreview: 'form' }, '*')
}, true)
</script>`

/**
 * Preview mode: a route of the draft, draft languages included, as it will publish, with the
 * site's scripts, motion and code, and the editor's asset URLs. A route is asked for by its path,
 * where a path the site lacks shows its 404 page, or by the page, entry and language being edited.
 */
export function renderSitePreview(
  doc: Document,
  siteId: string,
  query: { path?: string; page?: string; entry?: string; locale?: string },
):
  | { status: 200; body: { html: string; path: string; revision: number } }
  | { status: 404; body: { error: string } } {
  const routes = enumerateRoutes(doc, { drafts: true })
  const path = query.path?.replace(/(.)\/+$/, '$1')
  const route =
    path === undefined
      ? routes.find(
          (r) =>
            r.page === query.page &&
            r.entry === (query.entry || undefined) &&
            r.locale === (query.locale || undefined) &&
            !r.listPage,
        )
      : (routes.find((r) => r.path === path) ?? routes.find((r) => r.path === '/404'))
  if (!route) return { status: 404, body: { error: 'Page not found' } }
  const page = doc.pages[route.page]!
  const entry = (doc.entries[page.collection ?? ''] ?? []).find((e) => e.id === route.entry)
  const result = render(doc, page, entry, {
    ...(route.listPage ? { listPage: route.listPage } : {}),
    ...(route.locale ? { locale: route.locale } : {}),
    ...editorAssets(siteId),
  })
  const { css } = generateStylesheet(doc, { assetUrl: (asset) => assetUrl(siteId, asset) })
  result.head = `${result.head}\n${styleElement(css)}\n${PREVIEW_SCRIPT}`
  return {
    status: 200,
    body: { html: assembleDocument(result), path: path ?? route.path, revision: doc.revision },
  }
}
