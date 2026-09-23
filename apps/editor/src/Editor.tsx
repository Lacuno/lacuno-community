import type { State } from '@freeflow/schema'
import { useId, useState } from 'react'
import { message } from './api.js'
import type { LivePreview } from './Canvas.js'
import { CanvasPanel } from './CanvasPanel.js'
import { ComponentDialogs } from './ComponentDialogs.js'
import { EditorHeader } from './EditorHeader.js'
import type { InlineTarget } from './InlineTextEditor.js'
import { InspectorColumn } from './InspectorColumn.js'
import { ProjectColors } from './ProjectColors.js'
import { PublishPanel } from './PublishPanel.js'
import { Ribbon } from './Ribbon.js'
import { type Panel, Sidebar } from './Sidebar.js'
import { useDocumentSession } from './session.js'
import { applicableStates } from './states.js'
import { duplicateSelection, subtreeRestriction } from './structure.js'
import { useComponentEditing } from './useComponentEditing.js'
import { useImageDrop } from './useImageDrop.js'
import { usePreview } from './usePreview.js'
import { useStructureDrag } from './useStructureDrag.js'

const ribbonGroups: Record<string, string> = {
  Layout: 'Spacing & shape',
  Appearance: 'Colors',
  Effects: 'Effects',
  Motion: 'Motion',
}

export function Editor({ siteId, back }: { siteId: string; back: () => void }) {
  const [ribbonHost, setRibbonHost] = useState<HTMLDivElement | null>(null)
  const [ribbonTab, setRibbonTab] = useState('Home')
  const [sidebar, setSidebar] = useState<Panel>('Layers')
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [inlineTarget, setInlineTarget] = useState<InlineTarget>()
  const elementActionsId = useId()
  const ribbonGroup = ribbonGroups[ribbonTab] ?? 'Typography'
  const [pageId, setPageId] = useState('')
  const [entryId, setEntryId] = useState('')
  const [selected, setSelected] = useState('')
  const [revealSelection, setRevealSelection] = useState(0)
  const [width, setWidth] = useState(1100)
  const [picked, setState] = useState<State>('none')
  // Open with a token to show, or '' for none; undefined while closed.
  const [colorsOpen, setColorsOpen] = useState<string>()
  const [publishOpen, setPublishOpen] = useState(false)
  const [computed, setComputed] = useState<{ id: string; values: Record<string, string> }>({
    id: '',
    values: {},
  })
  const [livePreview, setLivePreview] = useState<LivePreview>({})
  const [colorPreview, setColorPreview] = useState<LivePreview>({})
  const session = useDocumentSession(siteId, {
    blocked: !!inlineTarget,
    setPageId,
    onLeave: () => setInlineTarget(undefined),
  })
  const { doc, error, busy, conflict, unsettled, frozen, save, leave, setError } = session
  const page = doc?.pages[pageId]
  // A picked state only stays active while the selection can be in it.
  const node = doc?.nodes[selected]
  const states = doc && node ? applicableStates(doc, node) : ['none' as const]
  const state = states.includes(picked) ? picked : 'none'
  const editing = useComponentEditing({
    session,
    pageRoot: page?.root,
    selected,
    setSelected,
    setSidebar,
  })
  const { editableDoc, editingRoot } = editing
  const entries = page?.collection ? (doc?.entries[page.collection] ?? []) : []
  const activeEntry = entries.find((entry) => entry.id === entryId)?.id ?? entries[0]?.id ?? ''
  const preview = usePreview({
    siteId,
    pageId,
    activeEntry,
    editingId: editing.editingId,
    revision: session.revision,
    onStale: session.onStale,
    setError,
  })
  const { uploadingImage, dropImage } = useImageDrop({ siteId, session, setSelected })
  async function nodeAction(action: 'duplicate' | 'delete', id: string) {
    if (!editableDoc || unsettled) return
    if (action === 'delete') {
      if (subtreeRestriction(editableDoc, id)) return
      if (await save([{ type: 'node.delete', id }])) setSelected('')
      return
    }
    try {
      const edit = duplicateSelection(editableDoc, id)
      if (await save(edit.operations)) setSelected(edit.node.id)
    } catch (error) {
      setError(message(error))
    }
  }
  const bindDragSurface = useStructureDrag({
    siteId,
    doc: editableDoc,
    root: editingRoot,
    uploadImage: dropImage,
    disabled: frozen || uploadingImage,
    save,
    select: (id) => {
      setSelected(id)
      setSidebar('Layers')
    },
  })
  return (
    <div className="editor">
      {uploadingImage && (
        <div className="image-upload-status" role="status">
          Uploading image…
        </div>
      )}
      <EditorHeader
        session={session}
        page={page}
        back={back}
        uploadingImage={uploadingImage}
        publish={() => {
          setInlineTarget(undefined)
          setPublishOpen(true)
        }}
      />
      {publishOpen && session.snapshot && (
        <PublishPanel
          siteId={siteId}
          revision={session.snapshot.revision}
          close={() => setPublishOpen(false)}
        />
      )}
      <Ribbon
        session={session}
        tab={ribbonTab}
        setTab={setRibbonTab}
        setHost={setRibbonHost}
        inlineTarget={inlineTarget}
        setInlineTarget={setInlineTarget}
        selected={selected}
        width={width}
        setSidebar={setSidebar}
        openColors={() => setColorsOpen('')}
      />
      {error && (
        <div className="error-banner" role="alert">
          {error}
          {conflict && (
            <button type="button" onClick={() => session.reload()}>
              Reload latest
            </button>
          )}
        </div>
      )}
      {colorsOpen !== undefined && doc && (
        <ProjectColors
          doc={doc}
          busy={busy}
          conflict={conflict}
          error={error}
          dirtyChanged={session.setDirty}
          save={save}
          close={() => setColorsOpen(undefined)}
          leave={leave}
          autoSave={(operations) => save(operations, 'auto')}
          previewChanged={setColorPreview}
          registerFlush={session.registerFlush}
          initial={colorsOpen}
        />
      )}
      <ComponentDialogs
        session={session}
        editing={editing}
        selected={selected}
        setSelected={setSelected}
      />
      <div className="editor-body" data-sidebar-expanded={sidebarExpanded}>
        <Sidebar
          session={session}
          editing={editing}
          siteId={siteId}
          sidebar={sidebar}
          setSidebar={setSidebar}
          expanded={sidebarExpanded}
          setExpanded={setSidebarExpanded}
          pageId={pageId}
          setPageId={setPageId}
          setEntryId={setEntryId}
          selected={selected}
          setSelected={setSelected}
          revealSelection={revealSelection}
          elementActionsId={elementActionsId}
          nodeAction={(action, id) => void nodeAction(action, id)}
        />
        <CanvasPanel
          session={session}
          editing={editing}
          page={page}
          entries={entries}
          activeEntry={activeEntry}
          setEntryId={setEntryId}
          preview={preview}
          width={width}
          setWidth={setWidth}
          state={state}
          states={states}
          setState={setState}
          selected={selected}
          setSelected={setSelected}
          reveal={() => setRevealSelection((value) => value + 1)}
          inlineTarget={inlineTarget}
          setInlineTarget={setInlineTarget}
          setRibbonTab={setRibbonTab}
          nodeAction={(action, id) => void nodeAction(action, id)}
          bindDragSurface={bindDragSurface}
          livePreview={{ ...livePreview, ...colorPreview }}
          setComputed={setComputed}
        />
        <InspectorColumn
          session={session}
          editing={editing}
          siteId={siteId}
          selected={selected}
          width={width}
          state={state}
          editingText={!!inlineTarget}
          ribbonHost={ribbonHost}
          ribbonGroup={ribbonGroup}
          computed={computed}
          setLivePreview={setLivePreview}
          showPresets={() => setRibbonTab('Home')}
          openToken={setColorsOpen}
          select={(id) => void leave(() => setSelected(id))}
        />
      </div>
    </div>
  )
}
