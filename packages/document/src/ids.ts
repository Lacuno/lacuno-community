import type { Document } from '@freeflow/schema'

/** Every id currently in use, across every map, so new ids never collide. */
export function allIds(doc: Document): Set<string> {
  const ids = new Set<string>()
  for (const map of [
    doc.pages,
    doc.folders,
    doc.nodes,
    doc.classes,
    doc.breakpoints,
    doc.designTokens,
    doc.components,
    doc.collections,
    doc.assets,
  ])
    for (const id of Object.keys(map)) ids.add(id)
  for (const m of doc.site.modes) ids.add(m.id)
  for (const entries of Object.values(doc.entries)) for (const e of entries) ids.add(e.id)
  for (const col of Object.values(doc.collections)) for (const f of col.fields) ids.add(f.id)
  return ids
}
