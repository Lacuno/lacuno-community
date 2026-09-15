import type { Document } from './document.js'
import { DOCUMENT_VERSION } from './document.js'
import { newId } from './ids.js'
import type { Node } from './nodes.js'
import { BASE_BREAKPOINT_ID } from './styles.js'

/**
 * A minimal valid document: one page, one empty body node, the default breakpoints, one mode.
 * Every other document starts from here.
 */
export function createEmptyDocument(name = 'Untitled'): Document {
  const rootId = newId()
  const pageId = newId()
  const root: Node = {
    id: rootId,
    type: 'element',
    tag: 'main',
    parent: null,
    children: [],
    classes: [],
  }
  return {
    version: DOCUMENT_VERSION,
    site: {
      name,
      locale: 'en',
      modes: [{ id: 'light', label: 'Light', default: true }],
      fonts: [],
    },
    pages: { [pageId]: { id: pageId, name: 'Home', path: '/', root: rootId } },
    folders: {},
    nodes: { [rootId]: root },
    classes: {},
    styles: {},
    breakpoints: {
      [BASE_BREAKPOINT_ID]: { id: BASE_BREAKPOINT_ID, label: 'Desktop' },
      tablet: { id: 'tablet', label: 'Tablet', maxWidth: 991 },
      'mobile-l': { id: 'mobile-l', label: 'Mobile landscape', maxWidth: 767 },
      'mobile-p': { id: 'mobile-p', label: 'Mobile portrait', maxWidth: 479 },
    },
    tokens: {},
    components: {},
    collections: {},
    entries: {},
    assets: {},
    redirects: [],
  }
}
