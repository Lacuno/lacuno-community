import type { Entry, Page, State } from '@lacuno/schema'
import { useState } from 'react'
import { boundFieldLabel } from './binding.js'
import { editingBreakpoint } from './breakpoints.js'
import { Canvas, type LivePreview } from './Canvas.js'
import type { CmsView } from './CollectionManager.js'
import { entryTitle } from './cms.js'
import { colorLabel, colorPreview, projectColors } from './colors.js'
import { componentUsage } from './components.js'
import { EditorIcon } from './EditorIcon.js'
import type { InlineTarget } from './InlineTextEditor.js'
import { type InnerTag, RICH_TAG_NAMES, richClassName } from './richTags.js'
import type { DocumentSession } from './session.js'
import { isLocked, type NodeAction, nodeLabel } from './structure.js'
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
  openCms,
  preview,
  width,
  setWidth,
  state,
  states,
  setState,
  selected,
  inner,
  setSelected,
  reveal,
  inlineTarget,
  setInlineTarget,
  focus,
  setFocus,
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
  openCms: (view: CmsView) => void
  preview: Preview | undefined
  width: number
  setWidth: (width: number) => void
  state: State
  states: State[]
  setState: (state: State) => void
  selected: string
  inner: InnerTag | undefined
  setSelected: (id: string, inner?: InnerTag) => void
  reveal: () => void
  inlineTarget: InlineTarget | undefined
  setInlineTarget: (target: InlineTarget | undefined) => void
  focus: boolean
  setFocus: (focus: boolean) => void
  nodeAction: (action: NodeAction, id: string) => void
  bindDragSurface: (surface: Document) => () => void
  livePreview: LivePreview
  setComputed: (value: { id: string; values: Record<string, string> }) => void
}) {
  const { doc, error, busy, frozen, leave } = session
  const [zoom, setZoom] = useState('fit')
  const { editingComponent } = editing
  const node = doc?.nodes[selected]
  const selectedName =
    node && doc
      ? inner
        ? `${RICH_TAG_NAMES[inner.tag]} in ${richClassName(doc, node)}`
        : nodeLabel(node)
      : ''
  const collection =
    page?.collection && !editingComponent ? doc?.collections[page.collection] : undefined
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
        <div className="canvas-viewport">
          {collection && (
            <div className="entry-switcher">
              <EditorIcon name="database" />
              {entries.length > 0 ? (
                <select
                  aria-label="Collection entry"
                  value={activeEntry}
                  onChange={(event) => setEntryId(event.target.value)}
                >
                  {entries.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entryTitle(collection, entry)}
                    </option>
                  ))}
                </select>
              ) : (
                <span>No {collection.name.toLowerCase()} yet</span>
              )}
              <button
                type="button"
                onClick={() =>
                  openCms({
                    collection: collection.id,
                    tab: 'entries',
                    entry: activeEntry || (session.readOnly ? '' : 'new'),
                  })
                }
              >
                {activeEntry ? 'Edit entry' : session.readOnly ? 'Open CMS' : 'Add entry'}
              </button>
            </div>
          )}
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
        <div className="canvas-view-controls">
          <select
            aria-label="Canvas zoom"
            value={zoom}
            onChange={(event) => setZoom(event.target.value)}
          >
            <option value="fit">Fit</option>
            {[50, 75, 100, 125, 150].map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Focus canvas"
            aria-pressed={focus}
            title="Focus canvas"
            disabled={!!inlineTarget}
            onClick={() => setFocus(!focus)}
          >
            <EditorIcon name="focus" />
          </button>
        </div>
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
              setFocus(false)
              setInlineTarget({ node, element })
            }}
            onNodeAction={nodeAction}
            bindDragSurface={bindDragSurface}
            onHistory={session.travel}
            livePreview={livePreview}
            onComputed={setComputed}
            html={preview.html}
            width={width}
            scale={zoom === 'fit' ? undefined : Number(zoom) / 100}
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
            inner={inner}
            selectedName={selectedName}
            selectedParentName={
              node?.parent && doc?.nodes[node.parent] ? nodeLabel(doc.nodes[node.parent]!) : ''
            }
            selectedField={node && doc && !inner ? boundFieldLabel(doc, node) : ''}
            restriction={
              session.readOnly || session.conflict
                ? 'View only'
                : doc && node && isLocked(doc, selected)
                  ? 'Locked'
                  : ''
            }
            select={(id, tag) => {
              reveal()
              if (id !== selected || JSON.stringify(tag) !== JSON.stringify(inner))
                void leave(() => setSelected(id, tag))
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
          {selectedName || 'Select an element'}
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
