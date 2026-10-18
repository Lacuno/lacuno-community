import { siteLocales } from '@lacuno/schema'
import { AssetsPanel } from './AssetsPanel.js'
import type { TranslateRequest } from './AutoTranslate.js'
import { message } from './api.js'
import { nodeHome } from './assets.js'
import { CmsPanel } from './CmsPanel.js'
import type { CmsView } from './CollectionManager.js'
import { ComponentsPanel } from './ComponentsPanel.js'
import { EditorIcon } from './EditorIcon.js'
import { LayersPanel } from './LayersPanel.js'
import { PagesPanel } from './PagesPanel.js'
import { InsertPanel } from './StructurePanel.js'
import type { DocumentSession } from './session.js'
import {
  insertionTarget,
  type NodeAction,
  structureInsertion,
  subtreeRestriction,
} from './structure.js'
import { TranslationsPanel } from './TranslationsPanel.js'
import { layoutLocked } from './translating.js'
import type { ComponentEditing } from './useComponentEditing.js'

export const sidebars = {
  Add: 'plus',
  Layers: 'layers',
  Components: 'component',
  Pages: 'page',
  CMS: 'database',
  Assets: 'image',
  Translations: 'globe',
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
  openCms,
  setLocale,
  translate,
  translated,
  keepInSync,
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
  openCms: (view: CmsView) => void
  nodeAction: (action: NodeAction, id: string) => void
  setLocale: (code: string) => void
  /** Opens Auto-translate for a language or one page of it. */
  translate: (request: TranslateRequest) => void
  /** The last auto-translation's line. */
  translated: string
  keepInSync: boolean
}) {
  const { doc, frozen, translating, save, leave, setError } = session
  const { editableDoc, editingRoot, editingComponent, editingId } = editing
  // Translations is a panel of a site in more than one language only.
  const several = !!session.snapshot && siteLocales(session.snapshot.document).length > 1
  return (
    <aside className="layers-panel">
      <nav className="sidebar-rail" aria-label="Editor panels">
        {(Object.keys(sidebars) as Panel[])
          .filter((name) => name !== 'Translations' || several)
          .map((name) => (
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
          disabled={frozen || translating || !doc}
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
            keepInSync={keepInSync}
            translating={
              translating && session.snapshot
                ? {
                    source: session.snapshot.document,
                    locale: session.locale,
                    lock: layoutLocked(doc),
                  }
                : undefined
            }
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
        {sidebar === 'CMS' && doc && (
          <CmsPanel
            session={session}
            open={openCms}
            showPage={(id) =>
              void leave(() => {
                setPageId(id)
                editing.setComponentId('')
                setSelected('')
                setEntryId('')
              })
            }
          />
        )}
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
            {translating && doc ? (
              <p className="hint">{layoutLocked(doc)}</p>
            ) : (
              editableDoc &&
              editingRoot && (
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
              )
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
              disabled={frozen || translating}
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
        {sidebar === 'Translations' && several && (
          <TranslationsPanel
            siteId={siteId}
            session={session}
            translate={translate}
            translated={translated}
            open={(locale, page, node) =>
              void leave(() => {
                setLocale(locale)
                editing.setComponentId('')
                setPageId(page)
                setEntryId('')
                setSelected(node)
              })
            }
          />
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
