import type { State } from '@miralo/schema'
import { editingBreakpoint } from './breakpoints.js'
import type { LivePreview } from './Canvas.js'
import { ComponentInstancePanel } from './ComponentsPanel.js'
import { EditorIcon } from './EditorIcon.js'
import { Inspector } from './Inspector.js'
import type { DocumentSession } from './session.js'
import type { ComponentEditing } from './useComponentEditing.js'

export function InspectorColumn({
  session,
  editing,
  siteId,
  selected,
  width,
  state,
  editingText,
  ribbonHost,
  ribbonGroup,
  computed,
  setLivePreview,
}: {
  session: DocumentSession
  editing: ComponentEditing
  siteId: string
  selected: string
  width: number
  state: State
  editingText: boolean
  ribbonHost: HTMLDivElement | null
  ribbonGroup: string
  computed: { id: string; values: Record<string, string> }
  setLivePreview: (preview: LivePreview) => void
}) {
  const { doc, busy, conflict, generation, save, registerFlush, setDirty } = session
  if (editingText)
    return (
      <aside className="inspector inspector-empty">
        <h2>Editing text</h2>
        <p>Select words on the canvas, then use Home to format them or add a link.</p>
        <p>Done saves your text. Cancel discards this editing session.</p>
      </aside>
    )
  if (doc && doc.nodes[selected]?.type === 'component')
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
  if (doc && selected && doc.nodes[selected])
    return (
      <Inspector
        siteId={siteId}
        key={`${selected}-${generation}-${editingBreakpoint(doc, width)}-${state}`}
        breakpoint={editingBreakpoint(doc, width)}
        state={state}
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
    )
  return (
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
  )
}
