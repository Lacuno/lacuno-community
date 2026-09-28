import { AssetsPanel } from './AssetsPanel.js'
import { message } from './api.js'
import { nodeHome } from './assets.js'
import { CmsPanel } from './CmsPanel.js'
import { ComponentsPanel } from './ComponentsPanel.js'
import { EditorIcon } from './EditorIcon.js'
import { LayersPanel } from './LayersPanel.js'
import { PagesPanel } from './PagesPanel.js'
import { InsertPanel } from './StructurePanel.js'
import type { DocumentSession } from './session.js'
import { insertionTarget, structureInsertion, subtreeRestriction } from './structure.js'
import type { ComponentEditing } from './useComponentEditing.js'

export const sidebars = {
  Add: 'plus',
  Layers: 'layers',
  Components: 'component',
  Pages: 'page',
  CMS: 'database',
  Assets: 'image',
} as const
export type Panel = keyof typeof sidebars

export function Sidebar({
  session,
  editing,
  siteId,
  sidebar,
  setSidebar,
  expanded,
  setExpanded,
  pageId,
  setPageId,
  setEntryId,
  selected,
  setSelected,
  revealSelection,
  elementActionsId,
  nodeAction,
  openColors,
}: {
  session: DocumentSession
  editing: ComponentEditing
  siteId: string
  sidebar: Panel
  setSidebar: (panel: Panel) => void
  expanded: boolean
  setExpanded: (update: (expanded: boolean) => boolean) => void
  pageId: string
  setPageId: (id: string) => void
  setEntryId: (id: string) => void
  selected: string
  setSelected: (id: string) => void
  revealSelection: number
  elementActionsId: string
  openColors: () => void
  nodeAction: (action: 'duplicate' | 'delete', id: string) => void
}) {
  const { doc, frozen, save, leave, setError } = session
  const { editableDoc, editingRoot, editingComponent, editingId } = editing
  return (
    <aside className="layers-panel">
      <nav className="sidebar-rail" aria-label="Editor panels">
        {(Object.keys(sidebars) as Panel[]).map((name) => (
          <button
            key={name}
            type="button"
            aria-label={name}
            title={name}
            aria-pressed={sidebar === name}
            onClick={() => setSidebar(name)}
          >
            <EditorIcon name={sidebars[name]} />
            {expanded && <span>{name}</span>}
          </button>
        ))}
        <button
          type="button"
          className="sidebar-styles"
          aria-label="Design tokens"
          title="Design tokens"
          disabled={frozen || !doc}
          onClick={openColors}
        >
          <EditorIcon name="token" />
          {expanded && <span>Design tokens</span>}
        </button>
        <button
          type="button"
          className="sidebar-expand"
          aria-label={expanded ? 'Collapse sidebar labels' : 'Expand sidebar labels'}
          title={expanded ? 'Hide tab names' : 'Show tab names'}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <EditorIcon name={expanded ? 'collapse' : 'expand'} />
          {expanded && <span>Collapse</span>}
        </button>
      </nav>
      <section className="sidebar-content" aria-label={`${sidebar} panel`}>
        {sidebar === 'Pages' && doc && (
          <PagesPanel
            doc={doc}
            siteId={siteId}
            selected={pageId}
            disabled={frozen}
            save={save}
            autoSave={(operations) => save(operations, 'auto')}
            choose={(id) =>
              void leave(() => {
                setPageId(id)
                editing.setComponentId('')
                setSelected('')
                setEntryId('')
                setError('')
              })
            }
          />
        )}
        {sidebar === 'CMS' && doc && <CmsPanel siteId={siteId} session={session} />}
        {editableDoc && editingRoot && (
          <div hidden={sidebar !== 'Assets'}>
            <AssetsPanel
              siteId={siteId}
              session={session}
              show={(id) =>
                void leave(() => {
                  const { page, component } = nodeHome(doc!, id)
                  editing.setComponentId(component?.id ?? '')
                  if (page) setPageId(page.id)
                  setEntryId('')
                  setSelected(id)
                  setSidebar('Layers')
                })
              }
              insert={async (preset, assetId) => {
                let target: ReturnType<typeof insertionTarget> | undefined
                let refused = ''
                for (const placement of ['inside', 'after', 'page'] as const) {
                  try {
                    target = insertionTarget(editableDoc, editingRoot, selected, placement)
                    break
                  } catch (error) {
                    refused = message(error)
                  }
                }
                if (!target) {
                  setError(refused)
                  return
                }
                const edit = structureInsertion(preset, target, '', false, assetId)
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
              <InsertPanel
                doc={editableDoc}
                root={editingRoot}
                selected={selected}
                disabled={frozen}
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
              save={save}
              doc={doc}
              editing={editingId}
              disabled={frozen}
              createReason={
                !selected
                  ? 'Select an element or container on the canvas to create a component.'
                  : editingComponent
                    ? 'Return to the page to create a component from a selection.'
                    : doc.nodes[selected]?.type === 'component'
                      ? 'This selection is already a component.'
                      : (subtreeRestriction(editableDoc, selected) ?? '')
              }
              create={() => editing.setComponentDialog('create')}
              insert={(id) => void editing.addComponent(id)}
              edit={editing.editComponent}
            />
          </>
        )}
        {sidebar === 'Layers' && (
          <LayersPanel
            session={session}
            editing={editing}
            selected={selected}
            setSelected={setSelected}
            revealSelection={revealSelection}
            elementActionsId={elementActionsId}
            nodeAction={nodeAction}
          />
        )}
      </section>
    </aside>
  )
}
