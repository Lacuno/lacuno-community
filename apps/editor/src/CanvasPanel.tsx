import type { Entry, Page, State } from '@miralo/schema'
import { editingBreakpoint } from './breakpoints.js'
import { Canvas, type LivePreview } from './Canvas.js'
import { colorLabel, colorPreview, projectColors } from './colors.js'
import { componentUsage } from './components.js'
import { EditorIcon } from './EditorIcon.js'
import type { InlineTarget } from './InlineTextEditor.js'
import type { DocumentSession } from './session.js'
import { isLocked, nodeLabel } from './structure.js'
import { tokensOfGroup, tokenValue } from './tokens.js'
import type { ComponentEditing } from './useComponentEditing.js'
import type { Preview } from './usePreview.js'

export function CanvasPanel({
  session,
  editing,
  page,
  entries,
  activeEntry,
  setEntryId,
  preview,
  width,
  setWidth,
  state,
  states,
  setState,
  selected,
  setSelected,
  reveal,
  inlineTarget,
  setInlineTarget,
  setRibbonTab,
  nodeAction,
  bindDragSurface,
  livePreview,
  setComputed,
}: {
  session: DocumentSession
  editing: ComponentEditing
  page: Page | undefined
  entries: Entry[]
  activeEntry: string
  setEntryId: (id: string) => void
  preview: Preview | undefined
  width: number
  setWidth: (width: number) => void
  state: State
  states: State[]
  setState: (state: State) => void
  selected: string
  setSelected: (id: string) => void
  reveal: () => void
  inlineTarget: InlineTarget | undefined
  setInlineTarget: (target: InlineTarget | undefined) => void
  setRibbonTab: (tab: string) => void
  nodeAction: (action: 'duplicate' | 'delete', id: string) => void
  bindDragSurface: (surface: Document) => () => void
  livePreview: LivePreview
  setComputed: (value: { id: string; values: Record<string, string> }) => void
}) {
  const { doc, error, busy, frozen, leave } = session
  const { editingComponent } = editing
  const snapTokens = (group: 'spacing' | 'size') =>
    doc
      ? tokensOfGroup(doc, group).map((token) => ({
          ref: token.id,
          name: token.name,
          value: tokenValue(doc, token),
        }))
      : []
  return (
    <main className="canvas-panel">
      {editingComponent && doc && (
        <section className="component-editing-bar" aria-label="Shared component editing">
          <EditorIcon name="component" />
          <strong>{editingComponent.name}</strong>
          <span>Shared design · {componentUsage(doc, editingComponent.id)} instances affected</span>
          <button
            type="button"
            disabled={frozen}
            onClick={() => editing.setComponentDialog('settings')}
          >
            Component settings…
          </button>
          <button type="button" disabled={busy} onClick={() => void leave(editing.exitComponent)}>
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
                name={label === 'Desktop' ? 'desktop' : label === 'Tablet' ? 'tablet' : 'mobile'}
              />
            </button>
          ))}
        </fieldset>
        <span className="muted">{width}px</span>
      </div>
      {/* biome-ignore lint/a11y: a mouse-only convenience; the empty space is not a control. */}
      <div
        className="canvas-workspace"
        onClick={(event) => {
          if (event.target === event.currentTarget && selected) void leave(() => setSelected(''))
        }}
      >
        {preview ? (
          <Canvas
            editingText={!!inlineTarget}
            onEditText={(id, element) => {
              const node = doc?.nodes[id]
              if (node?.type !== 'text' || frozen || !doc || isLocked(doc, id)) return
              if (node.text.type !== 'doc' && node.text.type !== 'static') return
              setSelected(id)
              setRibbonTab('Home')
              setInlineTarget({ node, element })
            }}
            onNodeAction={nodeAction}
            bindDragSurface={bindDragSurface}
            onHistory={session.travel}
            livePreview={livePreview}
            onComputed={setComputed}
            html={preview.html}
            width={width}
            state={state}
            states={states}
            onState={(next) => void leave(() => setState(next))}
            scope={doc ? (doc.breakpoints[editingBreakpoint(doc, width)]?.label ?? '') : ''}
            textColor={doc?.nodes[selected]?.type === 'text'}
            swatches={
              doc
                ? projectColors(doc).map((token) => ({
                    id: token.id,
                    name: colorLabel(token.name),
                    value: colorPreview(doc, token.id),
                  }))
                : []
            }
            tokens={{
              spacing: snapTokens('spacing'),
              size: snapTokens('size'),
            }}
            selected={selected}
            selectedName={doc?.nodes[selected] ? nodeLabel(doc.nodes[selected]!) : ''}
            select={(id) => {
              reveal()
              if (id !== selected) void leave(() => setSelected(id))
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
          {selected && doc?.nodes[selected] ? nodeLabel(doc.nodes[selected]) : 'Select an element'}
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
  )
}
