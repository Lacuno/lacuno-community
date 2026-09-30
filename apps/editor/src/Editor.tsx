import type { State } from '@lacuno/schema'
import { useCallback, useId, useMemo, useState } from 'react'
import type { Role } from './App.js'
import { message, useConfig } from './api.js'
import type { LivePreview } from './Canvas.js'
import { CanvasPanel } from './CanvasPanel.js'
import { type CmsView, CollectionManager } from './CollectionManager.js'
import { ComponentDialogs } from './ComponentDialogs.js'
import { ConnectPanel, useConnections } from './ConnectPanel.js'
import { EditorHeader } from './EditorHeader.js'
import type { InlineTarget } from './InlineTextEditor.js'
import { InspectorColumn } from './InspectorColumn.js'
import { PageSettings } from './PagesPanel.js'
import { ProjectColors } from './ProjectColors.js'
import { PublishPanel } from './PublishPanel.js'
import { type InnerTag, tagStates } from './richTags.js'
import { type Panel, Sidebar } from './Sidebar.js'
import { useDocumentSession } from './session.js'
import { applicableStates } from './states.js'
import {
  duplicateSelection,
  type NodeAction,
  siblingMove,
  subtreeRestriction,
} from './structure.js'
import { useThumbnail } from './thumbnail.js'
import { useComponentEditing } from './useComponentEditing.js'
import { useImageDrop } from './useImageDrop.js'
import { usePreview } from './usePreview.js'
import { useStructureDrag } from './useStructureDrag.js'

export function Editor({
  siteId,
  role,
  back,
}: {
  siteId: string
  /** Viewers see the site read-only; only the owner publishes. */
  role: Role
  back: () => void
}) {
  const [focus, setFocus] = useState(false)
  const [pageSettingsOpen, setPageSettingsOpen] = useState(false)
  const [sidebar, setSidebar] = useState<Panel>('Layers')
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [inlineTarget, setInlineTarget] = useState<InlineTarget>()
  const elementActionsId = useId()
  const [pageId, setPageId] = useState('')
  const [entryId, setEntryId] = useState('')
  const [selected, setSelectedNode] = useState('')
  // A tag inside the selected rich-text block, styled for every block with the block's class.
  const [inner, setInner] = useState<InnerTag>()
  const setSelected = useCallback((id: string, tag?: InnerTag) => {
    setSelectedNode(id)
    setInner(tag)
  }, [])
  const [revealSelection, setRevealSelection] = useState(0)
  const [width, setWidth] = useState(1100)
  const [picked, setState] = useState<State>('none')
  const [colorsOpen, setColorsOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [cmsView, setCmsView] = useState<CmsView>()
  const { connections, refresh: refreshConnections } = useConnections(siteId, connectOpen)
  const [computed, setComputed] = useState<{ id: string; values: Record<string, string> }>({
    id: '',
    values: {},
  })
  const [livePreview, setLivePreview] = useState<LivePreview>({})
  const [colorPreview, setColorPreview] = useState<LivePreview>({})
  // A stable object, so the canvas repaints its draft only when a preview changes.
  const draft = useMemo(() => ({ ...livePreview, ...colorPreview }), [livePreview, colorPreview])
  const session = useDocumentSession(siteId, {
    readOnly: role === 'viewer',
    blocked: !!inlineTarget,
    setPageId,
    onLeave: () => setInlineTarget(undefined),
  })
  const { doc, error, busy, conflict, unsettled, frozen, save, leave, setError } = session
  const page = doc?.pages[pageId]
  // A picked state only stays active while the selection can be in it.
  const node = doc?.nodes[selected]
  const states =
    doc && node ? (inner ? tagStates(inner.tag) : applicableStates(doc, node)) : ['none' as const]
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
  // The try editor keeps its one site in the browser, with no site list to show it in.
  const { config } = useConfig()
  useThumbnail(siteId, doc, !!config && !config.try && role !== 'viewer')
  const { uploadingImage, dropImage } = useImageDrop({ siteId, session, setSelected })
  async function nodeAction(action: NodeAction, id: string) {
    if (!editableDoc || unsettled) return
    if (action === 'up' || action === 'down') {
      const move = siblingMove(editableDoc, id, action === 'up' ? -1 : 1)
      if (move) await save([move])
      return
    }
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
        role={role}
        page={page}
        back={back}
        uploadingImage={uploadingImage}
        publish={() => {
          setInlineTarget(undefined)
          setPublishOpen(true)
        }}
        connections={connections}
        connect={() => {
          setInlineTarget(undefined)
          setConnectOpen(true)
        }}
      />
      {connectOpen && (
        <ConnectPanel
          siteId={siteId}
          role={role}
          connections={connections}
          refresh={refreshConnections}
          close={() => setConnectOpen(false)}
        />
      )}
      {publishOpen && session.snapshot && (
        <PublishPanel
          siteId={siteId}
          revision={session.snapshot.revision}
          close={() => setPublishOpen(false)}
        />
      )}
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
      {colorsOpen && doc && (
        <ProjectColors
          doc={doc}
          busy={busy}
          conflict={conflict}
          error={error}
          dirtyChanged={session.setDirty}
          save={save}
          close={() => setColorsOpen(false)}
          leave={leave}
          autoSave={(operations) => save(operations, 'auto')}
          previewChanged={setColorPreview}
          registerFlush={session.registerFlush}
        />
      )}
      {cmsView && doc && (
        <CollectionManager
          siteId={siteId}
          doc={doc}
          readOnly={session.readOnly}
          disabled={session.conflict}
          save={save}
          undo={() => session.travel('undo')}
          view={cmsView}
          setView={setCmsView}
          close={() => setCmsView(undefined)}
          showPage={(id) =>
            void leave(() => {
              setCmsView(undefined)
              editing.setComponentId('')
              setPageId(id)
              setSelected('')
              setEntryId('')
            })
          }
        />
      )}
      {pageSettingsOpen && doc && page && (
        <PageSettings
          doc={doc}
          siteId={siteId}
          page={page}
          disabled={frozen}
          close={() => setPageSettingsOpen(false)}
          save={save}
          choose={(id) => {
            setPageId(id)
            setSelected('')
            setEntryId('')
          }}
        />
      )}
      <ComponentDialogs
        session={session}
        editing={editing}
        selected={selected}
        setSelected={setSelected}
      />
      <div className="editor-body" data-sidebar-expanded={sidebarExpanded} data-focus={focus}>
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
          openColors={() => setColorsOpen(true)}
          openCms={setCmsView}
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
          openCms={setCmsView}
          preview={preview}
          width={width}
          setWidth={setWidth}
          state={state}
          states={states}
          setState={setState}
          selected={selected}
          inner={inner}
          setSelected={setSelected}
          reveal={() => setRevealSelection((value) => value + 1)}
          inlineTarget={inlineTarget}
          setInlineTarget={setInlineTarget}
          focus={focus}
          setFocus={setFocus}
          nodeAction={(action, id) => void nodeAction(action, id)}
          bindDragSurface={bindDragSurface}
          livePreview={draft}
          setComputed={setComputed}
        />
        <InspectorColumn
          selectNode={(id) =>
            void leave(() => {
              setSelected(id)
              setRevealSelection((value) => value + 1)
            })
          }
          session={session}
          editing={editing}
          siteId={siteId}
          selected={selected}
          inner={inner}
          selectTag={(tag) => void leave(() => setSelected(selected, tag && { tag, index: 0 }))}
          width={width}
          state={state}
          inlineTarget={inlineTarget}
          setInlineTarget={setInlineTarget}
          page={page}
          openPageSettings={() => setPageSettingsOpen(true)}
          clearSelection={() => void leave(() => setSelected(''))}
          computed={computed}
          setLivePreview={setLivePreview}
        />
      </div>
    </div>
  )
}
