import type { Page, State } from '@lacuno/schema'
import { lazy, Suspense } from 'react'
import { editingBreakpoint } from './breakpoints.js'
import type { LivePreview } from './Canvas.js'
import { ComponentInstancePanel } from './ComponentsPanel.js'
import { EditorIcon } from './EditorIcon.js'
import type { InlineTarget } from './InlineTextEditor.js'
import { Inspector } from './Inspector.js'
import type { DocumentSession } from './session.js'
import type { ComponentEditing } from './useComponentEditing.js'

const InlineTextEditor = lazy(() =>
  import('./InlineTextEditor.js').then((module) => ({ default: module.InlineTextEditor })),
)

export function InspectorColumn({
  session,
  editing,
  siteId,
  selected,
  width,
  state,
  inlineTarget,
  setInlineTarget,
  page,
  openPageSettings,
  clearSelection,
  computed,
  setLivePreview,
}: {
  session: DocumentSession
  editing: ComponentEditing
  siteId: string
  selected: string
  width: number
  state: State
  inlineTarget: InlineTarget | undefined
  setInlineTarget: (target: InlineTarget | undefined) => void
  page: Page | undefined
  openPageSettings: () => void
  clearSelection: () => void
  computed: { id: string; values: Record<string, string> }
  setLivePreview: (preview: LivePreview) => void
}) {
  const { doc, busy, conflict, generation, save, registerFlush, setDirty, readOnly } = session
  if (inlineTarget && doc)
    return (
      <aside className="inspector">
        <div className="selection-heading">
          <EditorIcon name="text" />
          <strong>Editing text</strong>
        </div>
        <div className="inspector-body">
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
        </div>
      </aside>
    )
  // A viewer reads the canvas and layers; the node inspectors only edit.
  if (doc && !readOnly && doc.nodes[selected]?.type === 'component')
    return (
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
          if (node?.type === 'component') editing.editComponent(node.component)
        }}
        detach={() => editing.setComponentDialog('detach')}
      />
    )
  if (doc && !readOnly && selected && doc.nodes[selected])
    return (
      <Inspector
        siteId={siteId}
        key={`${selected}-${generation}-${editingBreakpoint(doc, width)}-${state}`}
        breakpoint={editingBreakpoint(doc, width)}
        state={state}
        clearSelection={clearSelection}
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
    )
  return (
    <aside className="inspector page-inspector">
      <div className="selection-heading">
        <EditorIcon name="page" />
        <strong>{page?.name ?? 'Page'}</strong>
        <span className="element-badge">PAGE</span>
      </div>
      <div className="inspector-body">
        <section className="page-context">
          <dl>
            <div>
              <dt>Path</dt>
              <dd>{page?.path ?? '/'}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>{page?.lang ?? doc?.site.locale ?? '—'}</dd>
            </div>
          </dl>
          <button type="button" disabled={!page || session.frozen} onClick={openPageSettings}>
            <EditorIcon name="settings" />
            Page settings
          </button>
        </section>
        <p className="selection-hint">
          <EditorIcon name="layer" />
          Select an element on the canvas or in Layers to edit its properties.
        </p>
      </div>
    </aside>
  )
}
