import { lazy, Suspense } from 'react'
import { editingBreakpoint } from './breakpoints.js'
import { colorLabel, projectColors, colorPreview as swatchColor } from './colors.js'
import { EditorIcon } from './EditorIcon.js'
import type { InlineTarget } from './InlineTextEditor.js'
import type { Panel } from './Sidebar.js'
import type { DocumentSession } from './session.js'

const InlineTextEditor = lazy(() =>
  import('./InlineTextEditor.js').then((module) => ({ default: module.InlineTextEditor })),
)

export function Ribbon({
  session,
  tab,
  setTab,
  setHost,
  inlineTarget,
  setInlineTarget,
  selected,
  width,
  setSidebar,
  openColors,
}: {
  session: DocumentSession
  tab: string
  setTab: (tab: string) => void
  setHost: (host: HTMLDivElement | null) => void
  inlineTarget: InlineTarget | undefined
  setInlineTarget: (target: InlineTarget | undefined) => void
  selected: string
  width: number
  setSidebar: (panel: Panel) => void
  openColors: () => void
}) {
  const { doc, busy, conflict, frozen } = session
  return (
    <section className="editor-ribbon" aria-label="Formatting ribbon">
      <nav className="ribbon-tabs" aria-label="Formatting categories">
        {['Home', 'Layout', 'Appearance', 'Effects', 'Motion'].map((name) => (
          <button
            type="button"
            key={name}
            aria-pressed={tab === name}
            disabled={!!inlineTarget}
            className={tab === name ? 'active' : ''}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
        <button type="button" className="ribbon-insert" onClick={() => setSidebar('Add')}>
          <EditorIcon name="plus" />
          Insert
        </button>
      </nav>
      <div className="ribbon-body">
        <div className="ribbon-controls" ref={setHost}>
          {inlineTarget && doc && (
            <Suspense fallback={<p className="hint">Opening text editor…</p>}>
              <InlineTextEditor
                breakpoint={editingBreakpoint(doc, width)}
                target={inlineTarget}
                doc={doc}
                disabled={busy || conflict}
                save={session.save}
                close={() => setInlineTarget(undefined)}
                registerFlush={session.registerFlush}
                dirtyChanged={session.setDirty}
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
            disabled={frozen || !doc}
            onClick={openColors}
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
  )
}
