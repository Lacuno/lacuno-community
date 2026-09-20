import { applyPatches, type Patch } from '@freeflow/document/patch'
import { type Document, type Node, parseDocument } from '@freeflow/schema'
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Brand } from './App.js'
import { AssetsPanel, uploadImage } from './AssetsPanel.js'
import { ApiError, api } from './api.js'
import { editingBreakpoint } from './breakpoints.js'
import { Canvas } from './Canvas.js'
import {
  ComponentInstancePanel,
  ComponentSettingsDialog,
  ComponentsPanel,
  CreateComponentDialog,
  DetachComponentDialog,
} from './ComponentsPanel.js'
import { colorLabel, projectColors, colorPreview as swatchColor } from './colors.js'
import {
  componentEditingDocument,
  componentUsage,
  detachComponent,
  insertComponent,
} from './components.js'
import { EditorIcon } from './EditorIcon.js'
import {
  captureEdit,
  committedHistory,
  type EditOperation,
  emptyHistory,
  historyShortcut,
} from './history.js'
import type { InlineTarget } from './InlineTextEditor.js'
import { Inspector } from './Inspector.js'
import type { LivePreview } from './livePreview.js'
import { Navigator } from './Navigator.js'
import { PagesPanel } from './PagesPanel.js'
import { ProjectColors } from './ProjectColors.js'
import { PublishPanel } from './PublishPanel.js'
import { StructurePanel } from './StructurePanel.js'
import {
  duplicateSelection,
  insertionTarget,
  structureInsertion,
  subtreeRestriction,
} from './structure.js'
import { useStructureDrag } from './useStructureDrag.js'

type Snapshot = { document: Document; revision: number }
const InlineTextEditor = lazy(() =>
  import('./InlineTextEditor.js').then((module) => ({ default: module.InlineTextEditor })),
)
type Preview = { html: string; revision: number; warnings: { node: string; message: string }[] }
type Operation = EditOperation
const describe = (node: Node) => node.meta?.label ?? ('tag' in node ? node.tag : node.type)

export function Editor({ siteId, back }: { siteId: string; back: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [ribbonHost, setRibbonHost] = useState<HTMLDivElement | null>(null)
  const [ribbonTab, setRibbonTab] = useState('Home')
  const [sidebar, setSidebar] = useState<'Add' | 'Layers' | 'Components' | 'Pages' | 'Assets'>(
    'Layers',
  )
  const [inlineTarget, setInlineTarget] = useState<InlineTarget>()
  const elementActionsId = useId()
  const ribbonGroup =
    ribbonTab === 'Layout'
      ? 'Spacing & shape'
      : ribbonTab === 'Appearance'
        ? 'Colors'
        : ribbonTab === 'Effects'
          ? 'Effects'
          : ribbonTab === 'Motion'
            ? 'Motion'
            : 'Typography'
  const [pageId, setPageId] = useState('')
  const [entryId, setEntryId] = useState('')
  const [selected, setSelected] = useState('')
  const [componentId, setComponentId] = useState('')
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [componentDialog, setComponentDialog] = useState<'create' | 'settings' | 'detach'>()
  const returnSelection = useRef('')
  const [revealSelection, setRevealSelection] = useState(0)
  const [preview, setPreview] = useState<Preview>()
  const [width, setWidth] = useState(1100)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [saved, setSaved] = useState(false)
  const [colorsOpen, setColorsOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [computed, setComputed] = useState<{ id: string; values: Record<string, string> }>({
    id: '',
    values: {},
  })
  const [livePreview, setLivePreview] = useState<LivePreview>({})
  const [colorPreview, setColorPreview] = useState<LivePreview>({})
  const pendingFlush = useRef<() => Promise<boolean>>(async () => true)
  const registerFlush = useCallback((flush: () => Promise<boolean>) => {
    pendingFlush.current = flush
  }, [])
  const [generation, setGeneration] = useState(0)
  const [editHistory, setEditHistory] = useState(emptyHistory)
  const inFlight = useRef(false)
  const autoFlight = useRef(false)
  const revision = snapshot?.revision
  const doc = snapshot?.document
  const page = doc?.pages[pageId]
  const editingComponent = doc?.components[componentId]
  const editingId = editingComponent?.id ?? ''
  const editableDoc = useMemo(
    () => doc && componentEditingDocument(doc, editingComponent?.id ?? ''),
    [doc, editingComponent?.id],
  )
  const editingRoot = editingComponent?.root ?? page?.root
  const entries = page?.collection ? (doc?.entries[page.collection] ?? []) : []
  const activeEntry = entries.find((entry) => entry.id === entryId)?.id ?? entries[0]?.id ?? ''
  const acceptSnapshot = useCallback((next: Snapshot, reset = true) => {
    next.document = parseDocument(next.document)
    setSnapshot(next)
    setComponentId((current) => (next.document.components[current] ? current : ''))
    setPageId((current) =>
      next.document.pages[current]
        ? current
        : (Object.values(next.document.pages).find((item) => item.path === '/')?.id ??
          Object.keys(next.document.pages)[0] ??
          ''),
    )
    setConflict(false)
    if (reset) setDirty(false)
    setError('')
    if (reset) setGeneration((value) => value + 1)
  }, [])
  const load = useCallback(async () => {
    const next = await api<Snapshot>(`/api/sites/${siteId}/document`)
    acceptSnapshot(next)
    setEditHistory(emptyHistory())
  }, [siteId, acceptSnapshot])
  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different page or entry must discard the prior canvas.
  useEffect(() => {
    setPreview(undefined)
  }, [pageId, activeEntry, editingComponent?.id])
  useEffect(() => {
    if (!pageId || revision === undefined) return
    const controller = new AbortController()
    api<Preview>(
      `/api/sites/${siteId}/preview?page=${encodeURIComponent(pageId)}&entry=${encodeURIComponent(activeEntry)}${editingId ? `&component=${encodeURIComponent(editingId)}` : ''}`,
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return
        if (data.revision !== revision) {
          if (inFlight.current) return
          setConflict(true)
          setError('This site changed in another session. Reload the latest version to continue.')
        } else setPreview(data)
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [siteId, pageId, activeEntry, revision, editingId])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty || busy) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy])
  async function leave(action: () => void) {
    if (inFlight.current && !autoFlight.current) return
    if (
      (dirty || busy) &&
      !(await pendingFlush.current()) &&
      !window.confirm('Discard your unsaved changes?')
    )
      return
    setDirty(false)
    setSaved(false)
    setInlineTarget(undefined)
    action()
  }
  async function save(operations: Operation[], action: 'edit' | 'undo' | 'redo' | 'auto' = 'edit') {
    if (!snapshot || conflict || inFlight.current || operations.length === 0) return false
    inFlight.current = true
    autoFlight.current = action === 'auto'
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const entry =
        action === 'edit' || action === 'auto'
          ? captureEdit(snapshot.document, operations)
          : editHistory[action].at(-1)
      if (!entry) return false
      const result = await api<{ revision: number; patches: Patch[] }>(
        `/api/sites/${siteId}/document/apply`,
        {
          expectedRevision: snapshot.revision,
          operations,
        },
      )
      // Use this commit's patches, not a follow-up read that could include someone else's edits.
      const document = applyPatches(snapshot.document, result.patches)
      flushSync(() => {
        acceptSnapshot(
          { document: { ...document, revision: result.revision }, revision: result.revision },
          action !== 'auto',
        )
        setEditHistory(committedHistory(editHistory, action === 'auto' ? 'edit' : action, entry))
        setSaved(true)
      })
      return true
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true)
        setError(
          'This site changed in another session. Your draft is still here. Reload the latest version before editing again.',
        )
      } else setError(e instanceof Error ? e.message : 'Could not save changes')
      return false
    } finally {
      inFlight.current = false
      autoFlight.current = false
      setBusy(false)
    }
  }
  async function nodeAction(action: 'duplicate' | 'delete', id: string) {
    if (!editableDoc || busy || dirty || conflict || subtreeRestriction(editableDoc, id)) return
    if (action === 'duplicate') {
      const edit = duplicateSelection(editableDoc, id)
      if (await save(edit.operations)) setSelected(edit.node.id)
    } else {
      if (await save([{ type: 'node.delete', id }])) setSelected('')
    }
  }
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
      const edit = insertComponent(doc, id, editingRoot, selected, editingComponent?.id)
      if (await save(edit.operations)) {
        setSelected(edit.id)
        setSidebar('Layers')
      }
    } catch (error) {
      setError((error as Error).message)
    }
  }
  const [imageUpload, setImageUpload] = useState<{
    id: string
    asset: Awaited<ReturnType<typeof uploadImage>>
  }>()
  const [uploadingImage, setUploadingImage] = useState(false)
  const imageUploadFlight = useRef(false)
  async function dropImage(id: string, file: File) {
    if (imageUploadFlight.current) return
    imageUploadFlight.current = true
    setUploadingImage(true)
    setError('')
    try {
      setImageUpload({ id, asset: await uploadImage(siteId, file) })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not upload image.')
      imageUploadFlight.current = false
      setUploadingImage(false)
    }
  }
  useEffect(() => {
    if (!imageUpload || !doc || busy || dirty || conflict) return
    const { id, asset } = imageUpload
    setImageUpload(undefined)
    const node = doc.nodes[id]
    if (node?.type !== 'element' || node.tag !== 'img' || subtreeRestriction(doc, id)) {
      setError('This image can no longer be changed.')
      imageUploadFlight.current = false
      setUploadingImage(false)
      return
    }
    void save([
      ...(!doc.assets[asset.id] ? [{ type: 'asset.create' as const, ...asset }] : []),
      {
        type: 'node.update',
        id,
        attrs: { ...node.attrs, src: { type: 'asset', asset: asset.id } },
      },
    ]).then((ok) => {
      if (ok) setSelected(id)
      imageUploadFlight.current = false
      setUploadingImage(false)
    })
  })
  const canUndo =
    !!snapshot && editHistory.undo.length > 0 && !busy && !dirty && !conflict && !inlineTarget
  const bindDragSurface = useStructureDrag({
    siteId,
    doc: editableDoc,
    root: editingRoot,
    uploadImage: dropImage,
    disabled: busy || dirty || conflict || uploadingImage || !!inlineTarget,
    save,
    select: (id) => {
      setSelected(id)
      setSidebar('Layers')
    },
  })
  const canRedo =
    !!snapshot && editHistory.redo.length > 0 && !busy && !dirty && !conflict && !inlineTarget
  function travel(direction: 'undo' | 'redo') {
    if (!(direction === 'undo' ? canUndo : canRedo)) return
    const entry = editHistory[direction].at(-1)
    if (entry) void save(entry[direction], direction)
  }
  const travelRef = useRef(travel)
  travelRef.current = travel
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.target as Element | null)?.closest?.(
          'input, textarea, select, [contenteditable="true"]',
        )
      )
        return
      const direction = historyShortcut(event)
      if (direction) {
        event.preventDefault()
        travelRef.current(direction)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="editor">
      {uploadingImage && (
        <div className="image-upload-status" role="status">
          Uploading image…
        </div>
      )}
      <header className="editor-header">
        <button
          type="button"
          className="back-button"
          onClick={() => leave(back)}
          aria-label="Back to sites"
        >
          <EditorIcon name="back" />
        </button>
        <Brand />
        <span className="header-divider" />
        <span className="site-name">
          {doc?.site.name ?? 'Opening site…'}
          <span className="site-page-divider"> / </span>
          {page?.name}
        </span>
        <div className="row history-controls">
          <button
            type="button"
            onClick={() => travel('undo')}
            disabled={!canUndo}
            title="Undo saved edit (⌘/Ctrl Z)"
            aria-label="Undo"
            aria-keyshortcuts="Meta+Z Control+Z"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M9 4 4 9l5 5" />
              <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => travel('redo')}
            disabled={!canRedo}
            title="Redo saved edit (⌘/Ctrl Shift Z)"
            aria-label="Redo"
            aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="m15 4 5 5-5 5" />
              <path d="M20 9H10a6 6 0 0 0 0 12h3" />
            </svg>
          </button>
        </div>
        <span
          className="save-state"
          role="status"
          data-state={conflict || error ? 'error' : busy || dirty ? 'pending' : 'saved'}
        >
          {conflict
            ? 'Changes paused'
            : error
              ? 'Could not save'
              : busy
                ? 'Saving…'
                : dirty
                  ? 'Changes pending…'
                  : saved
                    ? 'All changes saved'
                    : 'Saved'}
        </span>
        <button
          type="button"
          onClick={() =>
            leave(() => {
              load().catch((e) => setError(e.message))
            })
          }
          disabled={busy}
          aria-label="Reload site"
          title="Reload site"
          className="reload-button"
        >
          <EditorIcon name="reload" />
        </button>
        <button
          type="button"
          className="publish-trigger publish-action"
          disabled={!snapshot || busy || conflict || uploadingImage}
          onClick={async () => {
            if (!(await pendingFlush.current())) {
              setError('Finish or correct your pending edits before publishing.')
              return
            }
            setDirty(false)
            setInlineTarget(undefined)
            setPublishOpen(true)
          }}
        >
          Publish
        </button>
      </header>
      {publishOpen && snapshot && (
        <PublishPanel
          siteId={siteId}
          revision={snapshot.revision}
          close={() => setPublishOpen(false)}
        />
      )}
      <section className="editor-ribbon" aria-label="Formatting ribbon">
        <nav className="ribbon-tabs" aria-label="Formatting categories">
          {['Home', 'Layout', 'Appearance', 'Effects', 'Motion'].map((tab) => (
            <button
              type="button"
              key={tab}
              aria-pressed={ribbonTab === tab}
              disabled={!!inlineTarget}
              className={ribbonTab === tab ? 'active' : ''}
              onClick={() => setRibbonTab(tab)}
            >
              {tab}
            </button>
          ))}
          <button type="button" className="ribbon-insert" onClick={() => setSidebar('Add')}>
            <EditorIcon name="plus" />
            Insert
          </button>
        </nav>
        <div className="ribbon-body">
          <div className="ribbon-controls" ref={setRibbonHost}>
            {inlineTarget && doc && (
              <Suspense fallback={<p className="hint">Opening text editor…</p>}>
                <InlineTextEditor
                  breakpoint={editingBreakpoint(doc, width)}
                  target={inlineTarget}
                  doc={doc}
                  disabled={busy || conflict}
                  save={save}
                  close={() => setInlineTarget(undefined)}
                  registerFlush={registerFlush}
                  dirtyChanged={setDirty}
                />
              </Suspense>
            )}
            {(!doc || !selected || !doc.nodes[selected]) && (
              <div className="ribbon-empty">
                <EditorIcon name="text" />
                <div>
                  <strong>Select an element to format</strong>
                  <span>Typography, colors and spacing, all in one place.</span>
                </div>
              </div>
            )}
            {doc?.nodes[selected]?.type === 'component' && (
              <div className="ribbon-empty">
                <EditorIcon name="component" />
                <div>
                  <strong>Component instance</strong>
                  <span>
                    Change its content in the inspector, or open the shared design to format it.
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="ribbon-project-colors">
            <button
              type="button"
              aria-label="Project colors"
              disabled={busy || dirty || conflict || !doc || !!inlineTarget}
              onClick={() => setColorsOpen(true)}
            >
              <span className="ribbon-swatches">
                {doc &&
                  projectColors(doc)
                    .slice(0, 4)
                    .map((color) => (
                      <span
                        key={color.id}
                        title={colorLabel(color.name)}
                        style={{ background: swatchColor(doc, color.id) }}
                      />
                    ))}
              </span>
              <span>Project colors</span>
            </button>
          </div>
        </div>
      </section>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          {conflict && (
            <button
              type="button"
              onClick={() =>
                leave(() => {
                  load().catch((e) => setError(e.message))
                })
              }
            >
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
          dirtyChanged={setDirty}
          save={save}
          close={() => setColorsOpen(false)}
          autoSave={(operations) => save(operations, 'auto')}
          previewChanged={setColorPreview}
        />
      )}
      {componentDialog === 'create' && editableDoc && (
        <CreateComponentDialog
          doc={editableDoc}
          selected={selected}
          disabled={busy || dirty || conflict}
          save={save}
          created={setSelected}
          close={() => setComponentDialog(undefined)}
        />
      )}
      {componentDialog === 'settings' && doc && editingComponent && (
        <ComponentSettingsDialog
          doc={doc}
          component={editingComponent}
          disabled={busy || dirty || conflict}
          save={save}
          close={() => setComponentDialog(undefined)}
        />
      )}
      {componentDialog === 'detach' && doc && doc.nodes[selected]?.type === 'component' && (
        <DetachComponentDialog
          name={doc.components[doc.nodes[selected].component]!.name}
          disabled={busy || dirty || conflict}
          close={() => setComponentDialog(undefined)}
          confirm={async () => {
            try {
              const edit = detachComponent(editableDoc ?? doc, selected)
              const saved = await save(edit.operations)
              if (saved) setSelected(edit.node.id)
              return saved
            } catch (error) {
              setError((error as Error).message)
              return false
            }
          }}
        />
      )}
      <div className="editor-body" data-sidebar-expanded={sidebarExpanded}>
        <aside className="layers-panel">
          <nav className="sidebar-rail" aria-label="Editor panels">
            {(['Add', 'Layers', 'Components', 'Pages', 'Assets'] as const).map((name) => (
              <button
                key={name}
                type="button"
                aria-label={name}
                title={name}
                aria-pressed={sidebar === name}
                onClick={() => setSidebar(name)}
              >
                <EditorIcon
                  name={
                    name === 'Add'
                      ? 'plus'
                      : name === 'Layers'
                        ? 'layers'
                        : name === 'Components'
                          ? 'component'
                          : name === 'Assets'
                            ? 'image'
                            : 'page'
                  }
                />
                {sidebarExpanded && <span>{name}</span>}
              </button>
            ))}
            <button
              type="button"
              className="sidebar-expand"
              aria-label={sidebarExpanded ? 'Collapse sidebar labels' : 'Expand sidebar labels'}
              title={sidebarExpanded ? 'Hide tab names' : 'Show tab names'}
              aria-expanded={sidebarExpanded}
              onClick={() => setSidebarExpanded((expanded) => !expanded)}
            >
              <EditorIcon name={sidebarExpanded ? 'collapse' : 'expand'} />
              {sidebarExpanded && <span>Collapse</span>}
            </button>
          </nav>
          <section className="sidebar-content" aria-label={`${sidebar} panel`}>
            {sidebar === 'Pages' && doc && (
              <PagesPanel
                doc={doc}
                selected={pageId}
                disabled={busy || dirty || conflict || !!inlineTarget}
                save={save}
                choose={(id) =>
                  void leave(() => {
                    setPageId(id)
                    setComponentId('')
                    setSelected('')
                    setEntryId('')
                    setError('')
                  })
                }
              />
            )}
            {editableDoc && editingRoot && (
              <div hidden={sidebar !== 'Assets'}>
                <div className="panel-title">Assets</div>
                <AssetsPanel
                  siteId={siteId}
                  doc={editableDoc}
                  disabled={busy || dirty || conflict || !!inlineTarget}
                  save={save}
                  insert={async (assetId) => {
                    let target: ReturnType<typeof insertionTarget>
                    try {
                      target = insertionTarget(editableDoc, editingRoot, selected, 'inside')
                    } catch {
                      try {
                        target = insertionTarget(editableDoc, editingRoot, selected, 'after')
                      } catch {
                        target = insertionTarget(editableDoc, editingRoot, selected, 'page')
                      }
                    }
                    const edit = structureInsertion('image', target, '', false, assetId)
                    if (await save(edit.operations)) {
                      setSelected(edit.node.id)
                      setSidebar('Layers')
                    }
                  }}
                />
              </div>
            )}
            {sidebar === 'Add' && (
              <>
                <div className="panel-title">Add elements</div>
                {editableDoc && editingRoot && (
                  <StructurePanel
                    doc={editableDoc}
                    root={editingRoot}
                    selected={selected}
                    disabled={busy || dirty || conflict || !!inlineTarget}
                    save={save}
                    select={(id) => {
                      setSelected(id)
                      setSidebar('Layers')
                    }}
                  />
                )}
              </>
            )}
            {sidebar === 'Components' && doc && editableDoc && (
              <>
                <div className="panel-title">
                  Components <span>{Object.keys(doc.components).length}</span>
                </div>
                <ComponentsPanel
                  doc={doc}
                  editing={editingComponent?.id ?? ''}
                  disabled={busy || dirty || conflict || !!inlineTarget}
                  createReason={
                    !selected
                      ? 'Select an element or container on the canvas to create a component.'
                      : editingComponent
                        ? 'Return to the page to create a component from a selection.'
                        : doc.nodes[selected]?.type === 'component'
                          ? 'This selection is already a component.'
                          : (subtreeRestriction(editableDoc, selected) ?? '')
                  }
                  create={() => setComponentDialog('create')}
                  insert={(id) => void addComponent(id)}
                  edit={editComponent}
                />
              </>
            )}
            {sidebar === 'Layers' && (
              <>
                <div className="panel-title">
                  Layers
                  <button
                    type="button"
                    className="element-actions-button"
                    aria-label="Element actions"
                    title="Element actions"
                    disabled={!selected}
                    popoverTarget={elementActionsId}
                  >
                    •••
                  </button>
                </div>
                {editableDoc && editingRoot && (
                  <div
                    id={elementActionsId}
                    popover="auto"
                    className="element-actions-popover"
                    key={selected}
                  >
                    <strong>
                      {editableDoc.nodes[selected]
                        ? describe(editableDoc.nodes[selected]!)
                        : 'Element actions'}
                    </strong>
                    <StructurePanel
                      nodeAction={(action) => void nodeAction(action, selected)}
                      mode="actions"
                      doc={editableDoc}
                      root={editingRoot}
                      selected={selected}
                      disabled={busy || dirty || conflict || !!inlineTarget}
                      save={save}
                      select={setSelected}
                    />
                    <div className="element-edit-actions">
                      {editableDoc.nodes[selected]?.type === 'component' ? (
                        <>
                          <button
                            type="button"
                            disabled={busy || dirty || conflict || !!inlineTarget}
                            onClick={() => {
                              document.getElementById(elementActionsId)?.hidePopover()
                              const node = editableDoc.nodes[selected]
                              if (node?.type === 'component') editComponent(node.component)
                            }}
                          >
                            Edit shared component
                          </button>
                          <button
                            type="button"
                            disabled={
                              busy ||
                              dirty ||
                              conflict ||
                              !!inlineTarget ||
                              !!subtreeRestriction(editableDoc, selected)
                            }
                            onClick={() => {
                              document.getElementById(elementActionsId)?.hidePopover()
                              setComponentDialog('detach')
                            }}
                          >
                            Detach from component…
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={
                            busy ||
                            dirty ||
                            conflict ||
                            !!inlineTarget ||
                            !!editingComponent ||
                            !!subtreeRestriction(editableDoc, selected)
                          }
                          onClick={() => {
                            document.getElementById(elementActionsId)?.hidePopover()
                            setComponentDialog('create')
                          }}
                        >
                          Create component…
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="layer-list">
                  {editableDoc && editingRoot && (
                    <Navigator
                      rootLabel={editingComponent?.name ?? 'Body'}
                      reveal={revealSelection}
                      key={editingRoot}
                      disabled={busy || dirty || conflict || !!inlineTarget}
                      save={save}
                      nodeAction={(action, id) => void nodeAction(action, id)}
                      doc={editableDoc}
                      root={editingRoot}
                      selected={selected}
                      actions={(id) =>
                        leave(() => {
                          setSelected(id)
                          requestAnimationFrame(() =>
                            document.getElementById(elementActionsId)?.showPopover(),
                          )
                        })
                      }
                      select={(id) => {
                        if (id !== selected) leave(() => setSelected(id))
                      }}
                    />
                  )}
                </div>
              </>
            )}
          </section>
        </aside>
        <main className="canvas-panel">
          {editingComponent && doc && (
            <section className="component-editing-bar" aria-label="Shared component editing">
              <EditorIcon name="component" />
              <strong>{editingComponent.name}</strong>
              <span>
                Shared design · {componentUsage(doc, editingComponent.id)} instances affected
              </span>
              <button
                type="button"
                disabled={busy || dirty || conflict || !!inlineTarget}
                onClick={() => setComponentDialog('settings')}
              >
                Component settings…
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void leave(() => {
                    setComponentId('')
                    setSelected(doc.nodes[returnSelection.current] ? returnSelection.current : '')
                  })
                }
              >
                Done
              </button>
            </section>
          )}
          <div className="canvas-toolbar">
            <div className="row">
              <span className="canvas-page">
                <EditorIcon name="page" />
                {page?.name ?? 'Canvas'}
              </span>
              {entries.length > 0 && (
                <select
                  aria-label="Collection entry"
                  value={activeEntry}
                  onChange={(event) => setEntryId(event.target.value)}
                >
                  {entries.map((entry, index) => (
                    <option key={entry.id} value={entry.id}>
                      {String(
                        Object.values(entry.fields).find((value) => typeof value === 'string') ??
                          `Entry ${index + 1}`,
                      )}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <fieldset className="viewport-switch" aria-label="Canvas width">
              {[
                [1100, 'Desktop'],
                [768, 'Tablet'],
                [390, 'Mobile'],
              ].map(([size, label]) => (
                <button
                  type="button"
                  key={size}
                  aria-label={String(label)}
                  title={String(label)}
                  className={width === size ? 'active' : ''}
                  onClick={() => {
                    if (width !== Number(size)) void leave(() => setWidth(Number(size)))
                  }}
                >
                  <EditorIcon
                    name={
                      label === 'Desktop' ? 'desktop' : label === 'Tablet' ? 'tablet' : 'mobile'
                    }
                  />
                </button>
              ))}
            </fieldset>
            <span className="muted">{width}px</span>
          </div>
          <div className="canvas-workspace">
            {preview ? (
              <Canvas
                editingText={!!inlineTarget}
                onEditText={(id, element) => {
                  const node = doc?.nodes[id]
                  if (node?.type !== 'text' || busy || dirty || conflict || inlineTarget) return
                  if (node.text.type !== 'doc' && node.text.type !== 'static') return
                  for (
                    let ancestor: Node | undefined = node;
                    ancestor;
                    ancestor = ancestor.parent ? doc?.nodes[ancestor.parent] : undefined
                  ) {
                    if (ancestor.meta?.locked) return
                  }
                  setSelected(id)
                  setRibbonTab('Home')
                  setInlineTarget({ node, element })
                }}
                onNodeAction={(action, id) => void nodeAction(action, id)}
                bindDragSurface={bindDragSurface}
                onHistory={travel}
                livePreview={{ ...livePreview, ...colorPreview }}
                onComputed={setComputed}
                html={preview.html}
                width={width}
                selected={selected}
                selectedName={doc?.nodes[selected] ? describe(doc.nodes[selected]!) : ''}
                select={(id) => {
                  setRevealSelection((value) => value + 1)
                  if (id !== selected) leave(() => setSelected(id))
                }}
              />
            ) : (
              <div className="canvas-empty">
                {error ? 'Preview unavailable' : 'Rendering your page…'}
              </div>
            )}
          </div>
          <footer className="canvas-footer">
            <span className="canvas-breadcrumb">
              {editingComponent?.name ?? page?.name ?? 'Page'}
              <EditorIcon name="chevron" />
              {selected && doc?.nodes[selected]
                ? describe(doc.nodes[selected])
                : 'Select an element'}
            </span>
            <span>
              {preview?.warnings.length
                ? `${preview.warnings.length} render warning(s)`
                : 'Changes apply instantly'}
            </span>
          </footer>
          {preview?.warnings.length ? (
            <details className="warnings">
              <summary>Render warnings</summary>
              {preview.warnings.map((warning) => (
                <p key={`${warning.node}-${warning.message}`}>{warning.message}</p>
              ))}
            </details>
          ) : null}
        </main>
        {inlineTarget ? (
          <aside className="inspector inspector-empty">
            <h2>Editing text</h2>
            <p>Select words on the canvas, then use Home to format them or add a link.</p>
            <p>Done saves your text. Cancel discards this editing session.</p>
          </aside>
        ) : doc && doc.nodes[selected]?.type === 'component' ? (
          <ComponentInstancePanel
            key={`${selected}-${generation}`}
            doc={doc}
            node={doc.nodes[selected]}
            busy={busy}
            conflict={conflict}
            save={(operations) => save(operations, 'auto')}
            registerFlush={registerFlush}
            dirtyChanged={setDirty}
            edit={() => {
              const node = doc.nodes[selected]
              if (node?.type === 'component') editComponent(node.component)
            }}
            detach={() => setComponentDialog('detach')}
          />
        ) : doc && selected && doc.nodes[selected] ? (
          <Inspector
            siteId={siteId}
            key={`${selected}-${generation}-${editingBreakpoint(doc, width)}`}
            breakpoint={editingBreakpoint(doc, width)}
            ribbonHost={ribbonHost}
            ribbonGroup={ribbonGroup}
            doc={doc}
            node={doc.nodes[selected]}
            computed={computed.id === selected ? computed.values : {}}
            previewChanged={setLivePreview}
            registerFlush={registerFlush}
            busy={busy}
            conflict={conflict}
            save={save}
            autoSave={(operations) => save(operations, 'auto')}
            dirtyChanged={setDirty}
          />
        ) : (
          <aside className="inspector">
            <div className="selection-heading">
              <strong>Design</strong>
            </div>
            <div className="inspector-empty">
              <span className="empty-selection-icon">
                <EditorIcon name="layer" />
              </span>
              <h2>Make it yours.</h2>
              <p>Select an element on the canvas or in the layers to make it yours.</p>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
