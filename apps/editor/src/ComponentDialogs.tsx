import { message } from './api.js'
import {
  ComponentSettingsDialog,
  CreateComponentDialog,
  DetachComponentDialog,
} from './ComponentsPanel.js'
import { detachComponent } from './components.js'
import type { DocumentSession } from './session.js'
import type { ComponentEditing } from './useComponentEditing.js'

export function ComponentDialogs({
  session,
  editing,
  selected,
  setSelected,
}: {
  session: DocumentSession
  editing: ComponentEditing
  selected: string
  setSelected: (id: string) => void
}) {
  const { doc, unsettled, save, setError } = session
  const { editableDoc, editingComponent, componentDialog } = editing
  const close = () => editing.setComponentDialog(undefined)
  return (
    <>
      {componentDialog === 'create' && editableDoc && (
        <CreateComponentDialog
          doc={editableDoc}
          selected={selected}
          disabled={unsettled}
          save={save}
          created={setSelected}
          close={close}
        />
      )}
      {componentDialog === 'settings' && doc && editingComponent && (
        <ComponentSettingsDialog
          doc={doc}
          component={editingComponent}
          disabled={unsettled}
          save={save}
          close={close}
        />
      )}
      {componentDialog === 'detach' && doc && doc.nodes[selected]?.type === 'component' && (
        <DetachComponentDialog
          name={doc.components[doc.nodes[selected].component]!.name}
          disabled={unsettled}
          close={close}
          confirm={async () => {
            try {
              const edit = detachComponent(editableDoc ?? doc, selected)
              const saved = await save(edit.operations)
              if (saved) setSelected(edit.node.id)
              return saved
            } catch (error) {
              setError(message(error))
              return false
            }
          }}
        />
      )}
    </>
  )
}
