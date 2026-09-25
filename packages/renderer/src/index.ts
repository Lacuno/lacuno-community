import { assembleDocument, render } from '@lacuno/compiler/render'
import { generateStylesheet, styleElement } from '@lacuno/css'
import type { AssetRef, Document, Entry, Page } from '@lacuno/schema'

export type CanvasResult = { html: string; warnings: { node: string; message: string }[] }

/** The canvas uses the compiler's DOM and CSS, with selection metadata and original assets. */
export function renderCanvas(
  doc: Document,
  page: Page,
  entry: Entry | undefined,
  siteId: string,
  editingComponent?: string,
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
  const assetUrl = (asset: AssetRef) =>
    `/api/sites/${encodeURIComponent(siteId)}/assets/${asset.hash}`
  const result = render(doc, page, entry, {
    annotateNodes: true,
    ...(editingComponent ? { editingComponent } : {}),
    resolveAsset: assetUrl,
    resolveImage: (asset) => ({
      src: assetUrl(asset),
      width: asset.width ?? 0,
      height: asset.height ?? 0,
    }),
  })
  // Only the canvas emits the forced state selectors the editor's state picker switches on.
  const { css } = generateStylesheet(doc, { assetUrl, previewStates: true })
  // A second barrier in addition to the iframe sandbox: site code cannot execute, submit forms,
  // change the base URL, or load another frame in the editor's authenticated origin.
  const policy =
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'"
  result.head = `<meta http-equiv="Content-Security-Policy" content="${policy}">\n${result.head}\n${styleElement(css)}`
  return { html: assembleDocument(result), warnings: result.warnings }
}

/** The editor's preview route: a page, entry or component the document lacks is an error. */
export function renderPreview(
  doc: Document,
  siteId: string,
  query: { page?: string; entry?: string; component?: string },
):
  | { status: 200; body: CanvasResult & { revision: number } }
  | { status: 400 | 404; body: { error: string } } {
  const page = doc.pages[query.page ?? '']
  if (!page) return { status: 404, body: { error: 'Page not found' } }
  const entry = page.collection
    ? doc.entries[page.collection]?.find((item) => item.id === query.entry)
    : undefined
  if (page.collection && !entry)
    return { status: 400, body: { error: 'Choose a collection entry to preview' } }
  if (query.component && !doc.components[query.component])
    return { status: 404, body: { error: 'Component not found' } }
  return {
    status: 200,
    body: { ...renderCanvas(doc, page, entry, siteId, query.component), revision: doc.revision },
  }
}
