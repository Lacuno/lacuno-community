import { classNames, contextFromDocument, selectorFor, serializeValue } from '@freeflow/css'
import { applyPatches, type Patch } from '@freeflow/document/patch'
import { type CssValue, type Document, type Node, parseDocument } from '@freeflow/schema'
import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Brand } from './App.js'
import { ApiError, api } from './api.js'
import { Canvas } from './Canvas.js'
import { ClassManager } from './ClassManager.js'
import { FormattingControls } from './FormattingControls.js'
import { formattingOperations, localClass, localValue, normalizeFormatting } from './formatting.js'
import {
  captureEdit,
  committedHistory,
  type EditOperation,
  emptyHistory,
  historyShortcut,
} from './history.js'
import type { LivePreview } from './livePreview.js'
import { ProjectColors } from './ProjectColors.js'
import { StructurePanel } from './StructurePanel.js'
import { useAutosave } from './useAutosave.js'

type Snapshot = { document: Document; revision: number }
type Preview = { html: string; revision: number; warnings: { node: string; message: string }[] }
type Operation = EditOperation
const describe = (node: Node) => node.meta?.label ?? ('tag' in node ? node.tag : node.type)

function Layers({
  doc,
  id,
  selected,
  select,
  depth = 0,
}: {
  doc: Document
  id: string
  selected: string
  select: (id: string) => void
  depth?: number
}) {
  const node = doc.nodes[id]
  if (!node || depth > 50) return null
  const children = [...node.children]
  if (node.type === 'component') {
    const root = doc.components[node.component]?.root
    if (root) children.unshift(root)
  }
  return (
    <>
      <button
        type="button"
        className={`layer ${selected === id ? 'selected' : ''}`}
        style={{ paddingLeft: 16 + depth * 13 }}
        onClick={() => select(id)}
        title={describe(node)}
      >
        <span className="layer-icon">
          {node.type === 'text' ? 'T' : node.type === 'component' ? '◇' : '▱'}
        </span>
        <span>{describe(node)}</span>
        {node.meta?.locked && <span>· locked</span>}
      </button>
      {children.map((child) => (
        <Layers
          key={child}
          doc={doc}
          id={child}
          selected={selected}
          select={select}
          depth={depth + 1}
        />
      ))}
    </>
  )
}

function editableText(node: Node): string | undefined {
  if (node.type !== 'text') return undefined
  if (node.text.type === 'static')
    return typeof node.text.value === 'string' ? node.text.value : undefined
  // Preserve structured rich text and bindings until the rich text / CMS editors are available.
  if (node.text.type === 'doc' && node.text.content?.length === 1) {
    const paragraph = node.text.content[0]
    const content = paragraph?.content as
      | { type: string; text?: string; marks?: unknown[] }[]
      | undefined
    if (
      paragraph?.type === 'paragraph' &&
      content?.every((item) => item.type === 'text' && !item.marks?.length)
    )
      return content.map((item) => item.text ?? '').join('')
  }
  return undefined
}

function Inspector({
  doc,
  node,
  busy,
  conflict,
  save,
  autoSave,
  dirtyChanged,
  computed,
  previewChanged,
  registerFlush,
}: {
  previewChanged: (preview: LivePreview) => void
  registerFlush: (flush: () => Promise<boolean>) => void
  computed: Record<string, string>
  doc: Document
  node: Node
  busy: boolean
  conflict: boolean
  save: (ops: Operation[]) => Promise<boolean>
  autoSave: (ops: Operation[]) => Promise<boolean>
  dirtyChanged: (dirty: boolean) => void
}) {
  const originalText = editableText(node)
  const [text, setText] = useState(originalText ?? '')
  const [changes, setChanges] = useState<Record<string, CssValue | null>>({})
  const [classDraft, setClassDraft] = useState(false)
  const classId = useRef(`c-${crypto.randomUUID()}`)
  const normalized = normalizeFormatting(changes)
  const pending = Object.fromEntries(
    Object.entries(normalized).filter(
      ([property, value]) =>
        JSON.stringify(value) !== JSON.stringify(localValue(doc, node, property) ?? null),
    ),
  )
  const invalid = Object.entries(pending).find(
    ([property, value]) =>
      value &&
      value.type !== 'designToken' &&
      !CSS.supports(property, serializeValue(value, contextFromDocument(doc))),
  )
  const validation = invalid
    ? `Enter a valid value for ${invalid[0]}, such as 24px or #334155.`
    : ''
  const textDirty = originalText !== undefined && text !== originalText
  const styleDirty = Object.keys(pending).length > 0
  useEffect(() => {
    dirtyChanged(textDirty || styleDirty || classDraft)
  }, [textDirty, styleDirty, classDraft, dirtyChanged])
  let locked = false
  let shared = false
  for (
    let current: Node | undefined = node;
    current;
    current = current.parent ? doc.nodes[current.parent] : undefined
  ) {
    if (current.meta?.locked) locked = true
    if (Object.values(doc.components).some((component) => component.root === current?.id))
      shared = true
  }
  const disabled = conflict || locked || classDraft
  const local = localClass(doc, node)
  const overrides = Object.values(doc.styles).filter(
    (style) => style.class === local && style.breakpoint === 'base' && style.state === 'none',
  )
  const operations: Operation[] = []
  if (textDirty)
    operations.push({
      type: 'node.update',
      id: node.id,
      text:
        node.type === 'text' && node.text.type === 'doc'
          ? {
              type: 'doc',
              content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
            }
          : { type: 'static', value: text },
    })
  if (!invalid) operations.push(...formattingOperations(doc, node, pending, () => classId.current))
  const autosave = useAutosave(operations, !disabled && !invalid, busy, autoSave)
  const flushRef = useRef(autosave.flush)
  flushRef.current = async () => !invalid && !classDraft && (await autosave.flush())
  useEffect(() => {
    registerFlush(() => flushRef.current())
    return () => registerFlush(async () => true)
  }, [registerFlush])
  const previewKey = JSON.stringify({
    node: {
      id: node.id,
      ...(local ? { selector: selectorFor(doc, classNames(doc), local, 'none') } : {}),
      ...(originalText !== undefined ? { text } : {}),
      styles: Object.fromEntries(
        Object.entries(normalized)
          .filter(
            ([property, value]) =>
              value === null ||
              CSS.supports(property, serializeValue(value, contextFromDocument(doc))),
          )
          .map(([property, value]) => [
            property,
            value === null ? null : serializeValue(value!, contextFromDocument(doc)),
          ]),
      ),
    },
  })
  useEffect(() => {
    previewChanged(JSON.parse(previewKey))
    return () => previewChanged({})
  }, [previewKey, previewChanged])
  return (
    <aside className="inspector">
      <div className="panel-title">
        INSPECTOR<span>{'tag' in node ? `<${node.tag}>` : node.type}</span>
      </div>
      <div className="inspector-body">
        <h2>{describe(node)}</h2>
        {shared && <p className="note">Shared component. Changes appear in every instance.</p>}
        {locked && <p className="note">This element or its parent is locked.</p>}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void autosave.flush()
          }}
        >
          {originalText !== undefined ? (
            <label>
              Text
              <textarea
                aria-label="Text"
                rows={3}
                value={text}
                disabled={disabled}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
          ) : node.type === 'text' ? (
            <p className="note">
              This text uses a binding or rich formatting. Content editing for this element comes
              later.
            </p>
          ) : null}
          <FormattingControls
            doc={doc}
            node={node}
            computed={computed}
            disabled={disabled}
            changes={changes}
            change={(property, value) =>
              setChanges((previous) => {
                const next = { ...previous }
                if (
                  JSON.stringify(value) === JSON.stringify(localValue(doc, node, property) ?? null)
                )
                  delete next[property]
                else next[property] = value
                return next
              })
            }
          />
          {validation && (
            <p className="error" role="alert">
              {validation}
            </p>
          )}
          <p className="hint" role="status">
            {conflict
              ? 'Changes paused. Reload to resolve the conflict.'
              : validation
                ? 'Waiting for a valid value.'
                : busy
                  ? 'Saving…'
                  : textDirty || styleDirty
                    ? 'Changes pending…'
                    : 'All changes saved'}
          </p>
          {autosave.hasFailed && !conflict && (
            <button type="button" onClick={autosave.retry}>
              Retry changes
            </button>
          )}
          <button
            className="reset-formatting"
            type="button"
            disabled={disabled || busy || !overrides.length || textDirty || styleDirty}
            onClick={() =>
              void save(
                formattingOperations(
                  doc,
                  node,
                  Object.fromEntries(overrides.map((style) => [style.property, null])),
                ),
              )
            }
          >
            Reset formatting
          </button>
        </form>
        <details className="advanced-classes">
          <summary>Advanced: shared classes</summary>
          <p className="hint">
            Reusable styles underneath this element. Direct formatting takes priority.
          </p>
          <ClassManager
            doc={doc}
            node={node}
            disabled={busy || conflict || locked || textDirty || styleDirty}
            save={save}
            draftChanged={setClassDraft}
          />
        </details>
      </div>
    </aside>
  )
}

export function Editor({ siteId, back }: { siteId: string; back: () => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [pageId, setPageId] = useState('')
  const [entryId, setEntryId] = useState('')
  const [selected, setSelected] = useState('')
  const [preview, setPreview] = useState<Preview>()
  const [width, setWidth] = useState(1100)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [saved, setSaved] = useState(false)
  const [colorsOpen, setColorsOpen] = useState(false)
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
  const entries = page?.collection ? (doc?.entries[page.collection] ?? []) : []
  const activeEntry = entries.find((entry) => entry.id === entryId)?.id ?? entries[0]?.id ?? ''
  const acceptSnapshot = useCallback((next: Snapshot, reset = true) => {
    next.document = parseDocument(next.document)
    setSnapshot(next)
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
  }, [pageId, activeEntry])
  useEffect(() => {
    if (!pageId || revision === undefined) return
    const controller = new AbortController()
    api<Preview>(
      `/api/sites/${siteId}/preview?page=${encodeURIComponent(pageId)}&entry=${encodeURIComponent(activeEntry)}`,
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
  }, [siteId, pageId, activeEntry, revision])
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
  const canUndo = !!snapshot && editHistory.undo.length > 0 && !busy && !dirty && !conflict
  const canRedo = !!snapshot && editHistory.redo.length > 0 && !busy && !dirty && !conflict
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
      <header className="editor-header">
        <button
          type="button"
          className="back-button"
          onClick={() => leave(back)}
          aria-label="Back to sites"
        >
          ←
        </button>
        <Brand />
        <span className="header-divider" />
        <strong className="site-name">{doc?.site.name ?? 'Opening site…'}</strong>
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
        <span className="save-state" role="status">
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
        >
          Reload site
        </button>
        <button
          type="button"
          disabled={busy || dirty || conflict || !doc}
          onClick={() => setColorsOpen(true)}
        >
          Project colors
        </button>
      </header>
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
      <div className="editor-body">
        <aside className="layers-panel">
          <div className="panel-title">
            PAGES<span>{doc ? Object.keys(doc.pages).length : ''}</span>
          </div>
          <div className="page-list">
            {doc &&
              Object.values(doc.pages).map((item) => (
                <button
                  type="button"
                  className={`page-link ${pageId === item.id ? 'active' : ''}`}
                  key={item.id}
                  onClick={() =>
                    leave(() => {
                      setPageId(item.id)
                      setSelected('')
                      setEntryId('')
                      setError('')
                    })
                  }
                >
                  <span>▤</span>
                  {item.name}
                  <span className="page-path">{item.collection ? 'CMS' : item.path}</span>
                </button>
              ))}
          </div>
          {doc && page && (
            <StructurePanel
              doc={doc}
              root={page.root}
              selected={selected}
              disabled={busy || dirty || conflict}
              save={save}
              select={setSelected}
            />
          )}
          <div className="panel-title">
            LAYERS<span>◇</span>
          </div>
          <div className="layer-list">
            {doc && page && (
              <Layers
                doc={doc}
                id={page.root}
                selected={selected}
                select={(id) => {
                  if (id !== selected) leave(() => setSelected(id))
                }}
              />
            )}
          </div>
        </aside>
        <main className="canvas-panel">
          <div className="canvas-toolbar">
            <div className="row">
              <span>{page?.name ?? 'Canvas'}</span>
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
                  className={width === size ? 'active' : ''}
                  onClick={() => setWidth(Number(size))}
                >
                  {label}
                </button>
              ))}
            </fieldset>
            <span className="muted">{width}px</span>
          </div>
          <div className="canvas-workspace">
            {preview ? (
              <Canvas
                onHistory={travel}
                livePreview={{ ...livePreview, ...colorPreview }}
                onComputed={setComputed}
                html={preview.html}
                width={width}
                selected={selected}
                select={(id) => {
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
            <span>Click an element to inspect it</span>
            <span>
              {preview?.warnings.length
                ? `${preview.warnings.length} render warning(s)`
                : 'Canvas preview · Scripts disabled'}
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
        {doc && selected && doc.nodes[selected] ? (
          <Inspector
            key={`${selected}-${generation}`}
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
            <div className="panel-title">INSPECTOR</div>
            <div className="inspector-empty">
              <span>↖</span>
              <h2>
                A little detail.
                <br />A big difference.
              </h2>
              <p>Select an element on the canvas or in the layers to make it yours.</p>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
