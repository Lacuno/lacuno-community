import { assembleDocument, render } from '@freeflow/compiler/render'
import { generateStylesheet } from '@freeflow/css'
import type { Document, Entry, Page } from '@freeflow/schema'

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
  const assetUrl = (hash: string) => `/api/sites/${encodeURIComponent(siteId)}/assets/${hash}`
  const result = render(doc, page, entry, {
    annotateNodes: true,
    ...(editingComponent ? { editingComponent } : {}),
    resolveAsset: (asset) => assetUrl(asset.hash),
    resolveImage: (asset) => ({
      src: assetUrl(asset.hash),
      width: asset.width ?? 0,
      height: asset.height ?? 0,
    }),
  })
  const { css } = generateStylesheet(doc, {
    assetUrl: (id) => (doc.assets[id] ? assetUrl(doc.assets[id].hash) : undefined),
  })
  // A second barrier in addition to the iframe sandbox: site code cannot execute, submit forms,
  // change the base URL, or load another frame in the editor's authenticated origin.
  const policy =
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self'; media-src 'self'; base-uri 'none'; form-action 'none'; frame-src 'none'"
  result.head = `<meta http-equiv="Content-Security-Policy" content="${policy}">\n${result.head}\n<style>${css.replace(/</g, '\\3c ')}</style>`
  return { html: assembleDocument(result), warnings: result.warnings }
}
