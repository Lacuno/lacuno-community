import { contextFromDocument, serializeValue } from '@freeflow/css'
import { applyPatches, type Patch } from '@freeflow/document/patch'
import { type Document, type Node, parseDocument, styleKey } from '@freeflow/schema'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Brand } from './App.js'
import { ApiError, api } from './api.js'
import { Canvas } from './Canvas.js'
import {
  captureEdit,
  committedHistory,
  type EditOperation,
  emptyHistory,
  historyShortcut,
} from './history.js'
import { StructurePanel } from './StructurePanel.js'

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
  dirtyChanged,
}: {
  doc: Document
  node: Node
  busy: boolean
  conflict: boolean
  save: (ops: Operation[]) => Promise<boolean>
  dirtyChanged: (dirty: boolean) => void
}) {
  const originalText = editableText(node)
  const [text, setText] = useState(originalText ?? '')
  const [classId, setClassId] = useState(node.classes.at(-1) ?? '')
  const [property, setProperty] = useState('font-size')
  const [value, setValue] = useState('')
  const [styleDirty, setStyleDirty] = useState(false)
  const [validation, setValidation] = useState('')
  const textDirty = originalText !== undefined && text !== originalText
  const coordinates = { class: classId, breakpoint: 'base', state: 'none' as const, property }
  const declaration = doc.styles[styleKey(coordinates)]
  const styleValue = declaration ? serializeValue(declaration.value, contextFromDocument(doc)) : ''
  useEffect(() => {
    setValue(styleValue)
    setStyleDirty(false)
  }, [styleValue])
  useEffect(() => {
    dirtyChanged(textDirty || styleDirty)
  }, [textDirty, styleDirty, dirtyChanged])
  const locked = node.meta?.locked ?? false
  const shared = Object.values(doc.components).some((component) => {
    let current: Node | undefined = node
    while (current) {
      if (current.id === component.root) return true
      current = current.parent ? doc.nodes[current.parent] : undefined
    }
    return false
  })
  return (
    <aside className="inspector">
      <div className="panel-title">
        INSPECTOR<span>{'tag' in node ? `<${node.tag}>` : node.type}</span>
      </div>
      <div className="inspector-body">
        <h2>{describe(node)}</h2>
        {shared && <p className="note">Shared component. Changes appear in every instance.</p>}
        {locked && <p className="note">This element is locked.</p>}
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            setValidation('')
            const operations: Operation[] = []
            if (textDirty)
              operations.push({
                type: 'node.update',
                id: node.id,
                text:
                  node.type === 'text' && node.text.type === 'doc'
                    ? {
                        type: 'doc',
                        content: [
                          { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] },
                        ],
                      }
                    : { type: 'static', value: text },
              })
            if (styleDirty && classId) {
              if (value.trim()) {
                if (!CSS.supports(property, value.trim())) {
                  setValidation('Enter a valid CSS value, such as 24px or #334155.')
                  return
                }
                operations.push({
                  type: 'style.set',
                  ...coordinates,
                  value: { type: 'raw', value: value.trim() },
                  ...(declaration?.important ? { important: true } : {}),
                })
              } else if (declaration) operations.push({ type: 'style.clear', ...coordinates })
            }
            if (operations.length && (await save(operations))) dirtyChanged(false)
          }}
        >
          {originalText !== undefined ? (
            <label>
              Text
              <textarea
                aria-label="Text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={5}
                disabled={locked || busy}
              />
            </label>
          ) : node.type === 'text' ? (
            <p className="note">
              This text uses a binding or rich formatting. Content editing for this element comes
              later.
            </p>
          ) : null}
          <div className="section-label">STYLE</div>
          {node.classes.length ? (
            <>
              <label>
                Class
                <select
                  value={classId}
                  disabled={busy || styleDirty}
                  onChange={(event) => setClassId(event.target.value)}
                >
                  {node.classes.map((id) => (
                    <option key={id} value={id}>
                      {doc.classes[id]?.name ?? 'Local style'}
                    </option>
                  ))}
                </select>
              </label>
              <p className="hint">
                Applies to every element using this class. Base breakpoint, default state.
              </p>
              <label>
                Property
                <select
                  value={property}
                  disabled={busy || styleDirty}
                  onChange={(event) => setProperty(event.target.value)}
                >
                  {[
                    'font-size',
                    'font-weight',
                    'line-height',
                    'color',
                    'background-color',
                    'padding',
                    'gap',
                    'border-radius',
                    'max-width',
                  ].map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Value
                <input
                  value={value}
                  disabled={locked || busy || doc.classes[classId]?.locked}
                  placeholder="e.g. 24px"
                  onChange={(event) => {
                    setValue(event.target.value)
                    setStyleDirty(event.target.value !== styleValue)
                  }}
                />
              </label>
              <p className="hint">Leave empty to remove this declaration.</p>
            </>
          ) : (
            <p className="note">No class assigned. Class creation comes later.</p>
          )}
          {validation && (
            <p className="error" role="alert">
              {validation}
            </p>
          )}
          <button
            className="primary"
            type="submit"
            disabled={busy || locked || (!textDirty && !styleDirty)}
          >
            {conflict ? 'Reload to continue' : busy ? 'Saving…' : 'Save changes'}
          </button>
        </form>
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
  const [generation, setGeneration] = useState(0)
  const [editHistory, setEditHistory] = useState(emptyHistory)
  const inFlight = useRef(false)
  const revision = snapshot?.revision
  const doc = snapshot?.document
  const page = doc?.pages[pageId]
  const entries = page?.collection ? (doc?.entries[page.collection] ?? []) : []
  const activeEntry = entries.find((entry) => entry.id === entryId)?.id ?? entries[0]?.id ?? ''
  const acceptSnapshot = useCallback((next: Snapshot) => {
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
    setDirty(false)
    setError('')
    setGeneration((value) => value + 1)
  }, [])
  const load = useCallback(async () => {
    const next = await api<Snapshot>(`/api/sites/${siteId}/document`)
    acceptSnapshot(next)
    setEditHistory(emptyHistory())
  }, [siteId, acceptSnapshot])
  useEffect(() => {
    load().catch((e) => setError(e.message))
  }, [load])
  useEffect(() => {
    if (!pageId || revision === undefined) return
    const controller = new AbortController()
    setPreview(undefined)
    api<Preview>(
      `/api/sites/${siteId}/preview?page=${encodeURIComponent(pageId)}&entry=${encodeURIComponent(activeEntry)}`,
      undefined,
      controller.signal,
    )
      .then((data) => {
        if (data.revision !== revision) {
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
      if (dirty) event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  function leave(action: () => void) {
    if (busy) return
    if (dirty && !window.confirm('Discard your unsaved changes?')) return
    setDirty(false)
    setSaved(false)
    action()
  }
  async function save(operations: Operation[], action: 'edit' | 'undo' | 'redo' = 'edit') {
    if (!snapshot || conflict || inFlight.current || operations.length === 0) return false
    inFlight.current = true
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const entry =
        action === 'edit' ? captureEdit(snapshot.document, operations) : editHistory[action].at(-1)
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
      acceptSnapshot({
        document: { ...document, revision: result.revision },
        revision: result.revision,
      })
      setEditHistory(committedHistory(editHistory, action, entry))
      setSaved(true)
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
          {busy ? 'Saving…' : dirty ? 'Unsaved changes' : saved ? 'All changes saved' : 'Saved'}
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
            busy={busy || conflict}
            conflict={conflict}
            save={save}
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
