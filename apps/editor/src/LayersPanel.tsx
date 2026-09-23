import { Navigator } from './Navigator.js'
import { ElementActions } from './StructurePanel.js'
import type { DocumentSession } from './session.js'
import { nodeLabel } from './structure.js'
import type { ComponentEditing } from './useComponentEditing.js'

/** The layer tree plus the element actions popover that the tree's row menu opens. */
export function LayersPanel({
  session,
  editing,
  selected,
  setSelected,
  revealSelection,
  elementActionsId,
  nodeAction,
}: {
  session: DocumentSession
  editing: ComponentEditing
  selected: string
  setSelected: (id: string) => void
  revealSelection: number
  elementActionsId: string
  nodeAction: (action: 'duplicate' | 'delete', id: string) => void
}) {
  const { frozen, save, leave } = session
  const { editableDoc, editingRoot, editingComponent } = editing
  return (
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
              ? nodeLabel(editableDoc.nodes[selected]!)
              : 'Element actions'}
          </strong>
          <ElementActions
            nodeAction={nodeAction}
            doc={editableDoc}
            selected={selected}
            disabled={frozen}
            save={save}
            select={setSelected}
          />
        </div>
      )}
      <div className="layer-list">
        {editableDoc && editingRoot && (
          <Navigator
            rootLabel={editingComponent?.name ?? 'Body'}
            reveal={revealSelection}
            key={editingRoot}
            disabled={frozen}
            save={save}
            nodeAction={nodeAction}
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
  )
}
