import type { Document, State } from '@lacuno/schema'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Role } from './App.js'
import { AskAi } from './AskAi.js'
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
  nodeLabel,
  siblingMove,
  structureRestriction,
  subtreeRestriction,
} from './structure.js'
import { useThumbnail } from './thumbnail.js'
import { useComponentEditing } from './useComponentEditing.js'
import { useImageDrop } from './useImageDrop.js'
import { type Preview, usePreview } from './usePreview.js'
import { useStructureDrag } from './useStructureDrag.js'

/** Why a sibling move gave nothing, in a sentence for the status line. */
function moveRefusal(doc: Document, id: string, direction: -1 | 1) {
  const restriction = structureRestriction(doc, id)
  if (restriction) return restriction
  const node = doc.nodes[id]
  const parent = node?.parent ? doc.nodes[node.parent] : undefined
  if (!parent) return 'The page root cannot be moved.'
  const neighbour = doc.nodes[parent.children[parent.children.indexOf(id) + direction] ?? '']
  if (!neighbour) return `Already ${direction < 0 ? 'first' : 'last'} in ${nodeLabel(parent)}`
  return `${nodeLabel(neighbour)} is locked.`
}

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
  const [askOpen, setAskOpen] = useState(false)
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
  const [preview, setPreview] = useState<Preview>()
  const session = useDocumentSession(siteId, {
    readOnly: role === 'viewer',
    blocked: !!inlineTarget,
    setPageId,
    onLeave: () => setInlineTarget(undefined),
    // Read when a save goes out, after the render that declares these below.
    canvas: () => ({ page: pageId, entry: activeEntry, component: editing.editingId }),
    setPreview,
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
  usePreview({
    siteId,
    pageId,
    activeEntry,
    editingId: editing.editingId,
    revision: session.revision,
    preview,
    setPreview,
    onStale: session.onStale,
    setError,
  })
  // The try editor keeps its one site in the browser, with no site list to show it in.
  const { config } = useConfig()
  useThumbnail(siteId, doc, !!config && !config.try && role !== 'viewer')
  const { uploadingImage, dropImage } = useImageDrop({ siteId, session, setSelected })
  // A refusal on the header's status line for a moment, where the save state otherwise reads.
  const [notice, setNotice] = useState('')
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const notify = (text: string) => {
    clearTimeout(noticeTimer.current)
    setNotice(text)
    noticeTimer.current = setTimeout(() => setNotice(''), 3000)
  }
  // A save that follows makes the refusal stale: the line reports the save instead.
  useEffect(() => {
    if (busy) setNotice('')
  }, [busy])
  // What a shortcut acts on after it waited for a pending draft: the render that landed it.
  const latest = useRef({ editableDoc, save })
  latest.current = { editableDoc, save }
  async function nodeAction(action: NodeAction, id: string) {
    if (!editableDoc || conflict) return
    // A draft in a panel or a save in flight goes first; the key then acts on what it left.
    if (unsettled && !(await session.flushPending())) return
    const { editableDoc: current, save: commit } = latest.current
    if (!current) return
    if (action === 'up' || action === 'down') {
      const direction = action === 'up' ? -1 : 1
      const move = siblingMove(current, id, direction)
      if (move) await commit([move])
      else notify(moveRefusal(current, id, direction))
      return
    }
    if (action === 'delete') {
      const restriction = subtreeRestriction(current, id)
      if (restriction) {
        notify(restriction)
        return
      }
      // The next sibling takes the selection, else the previous one, else the parent, so the
      // layers keep showing the place the element had instead of closing its branch.
      const parent = current.nodes[id]?.parent
      const siblings = parent ? (current.nodes[parent]?.children ?? []) : []
      const at = siblings.indexOf(id)
      const next =
        siblings[at + 1] ?? siblings[at - 1] ?? (current.nodes[parent ?? '']?.parent && parent)
      if (await commit([{ type: 'node.delete', id }])) setSelected(next || '')
      return
    }
    try {
      const edit = duplicateSelection(current, id)
      if (await commit(edit.operations)) setSelected(edit.node.id)
    } catch (error) {
      setError(message(error))
    }
  }
  const bindDragSurface = useStructureDrag({
    siteId,
    doc: editableDoc,
    root: editingRoot,
    uploadImage: dropImage,
    // A pending draft is no reason to refuse a drag: the drop flushes it first.
    disabled: busy || conflict || session.readOnly || !!inlineTarget || uploadingImage,
    flush: session.flushPending,
    notice: notify,
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
        notice={notice}
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
      {askOpen && doc && node && page && (
        <AskAi
          site={doc.site.name}
          page={page}
          label={nodeLabel(node)}
          id={selected}
          close={() => setAskOpen(false)}
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
          ask={() => setAskOpen(true)}
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
          setWidth={setWidth}
          setState={setState}
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
