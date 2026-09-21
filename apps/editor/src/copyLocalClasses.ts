import type { Operation } from '@freeflow/document'
import type { Document } from '@freeflow/schema'

/** Copy editable local styles once per duplicated subtree; shared/locked/combo classes retain identity. */
export function localClassCopier(doc: Document, operations: Operation[]) {
  const copies = new Map<string, string>()
  const comboParents = new Set(Object.values(doc.classes).flatMap((cls) => cls.combo ?? []))
  return (classes: string[]) =>
    classes.map((id) => {
      const cls = doc.classes[id]
      if (cls?.kind !== 'local' || cls.combo?.length || cls.locked || comboParents.has(id))
        return id
      let copy = copies.get(id)
      if (!copy) {
        copy = `c-${crypto.randomUUID()}`
        copies.set(id, copy)
        operations.push({ type: 'class.create', id: copy, local: true })
        for (const style of Object.values(doc.styles).filter((style) => style.class === id))
          operations.push({ type: 'style.set', ...structuredClone(style), class: copy })
      }
      return copy
    })
}
