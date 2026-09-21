import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { message } from './api.js'
import { componentEditingDocument, insertComponent } from './components.js'
import type { Panel } from './Sidebar.js'
import type { DocumentSession } from './session.js'

export type ComponentEditing = ReturnType<typeof useComponentEditing>

type Options = {
  session: DocumentSession
  pageRoot: string | undefined
  selected: string
  setSelected: (id: string) => void
  setSidebar: (panel: Panel) => void
}

/** Editing a shared component swaps the whole editing surface for its definition. */
export function useComponentEditing({
  session,
  pageRoot,
  selected,
  setSelected,
  setSidebar,
}: Options) {
  const { doc, save, leave, setError } = session
  const [componentId, setComponentId] = useState('')
  const [componentDialog, setComponentDialog] = useState<'create' | 'settings' | 'detach'>()
  const returnSelection = useRef('')
  const editingComponent = doc?.components[componentId]
  const editingId = editingComponent?.id ?? ''
  const editingRoot = editingComponent?.root ?? pageRoot
  const editableDoc = useMemo(
    () => doc && componentEditingDocument(doc, editingId),
    [doc, editingId],
  )
  const exitComponent = useCallback(() => {
    setComponentId('')
    setSelected(doc?.nodes[returnSelection.current] ? returnSelection.current : '')
  }, [doc, setSelected])
  // The edited definition was deleted: leave the shared editor the same way Done does, before
  // the paint that would show it.
  useLayoutEffect(() => {
    if (doc && componentId && !doc.components[componentId]) exitComponent()
  }, [doc, componentId, exitComponent])
  const editComponent = (id: string) =>
    void leave(() => {
      if (!doc?.components[id]) return
      if (!editingComponent) returnSelection.current = selected
      setComponentId(id)
      setSelected(doc.components[id]!.root)
      setSidebar('Layers')
    })
  const addComponent = async (id: string) => {
    if (!doc || !editingRoot) return
    try {
      const edit = insertComponent(doc, id, editingRoot, selected, editingId)
      if (await save(edit.operations)) {
        setSelected(edit.id)
        setSidebar('Layers')
      }
    } catch (error) {
      setError(message(error))
    }
  }
  return {
    componentId,
    setComponentId,
    editingComponent,
    editingId,
    editingRoot,
    editableDoc,
    exitComponent,
    editComponent,
    addComponent,
    componentDialog,
    setComponentDialog,
  }
}
