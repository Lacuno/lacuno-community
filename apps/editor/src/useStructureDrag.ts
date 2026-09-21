import type { Operation } from '@freeflow/document'
import type { Document as SiteDocument } from '@freeflow/schema'
import { useEffect, useRef } from 'react'
import { createDragPreview } from './dragPreview.js'
import { canvasDropTarget } from './dragTarget.js'
import {
  canContain,
  type DragItem,
  type DropPosition,
  dropEdit,
  dropTarget,
  type Preset,
  structureRestriction,
} from './structure.js'

type Options = {
  siteId: string
  doc: SiteDocument | undefined
  root: string | undefined
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
  uploadImage: (id: string, file: File) => void
  select: (id: string) => void
}

/** Share a native drag session between the editor document and its same-origin canvas. */
export function useStructureDrag(options: Options) {
  const current = useRef(options)
  current.current = options
  const controller = useRef<ReturnType<typeof createController> | null>(null)
  if (!controller.current) controller.current = createController(() => current.current)
  const bind = controller.current.bind
  useEffect(() => bind(document), [bind])
  return bind
}

function createController(getOptions: () => Options) {
  let item: DragItem | undefined
  const clearers = new Set<() => void>()
  const clear = (except?: () => void) => {
    for (const reset of clearers) if (reset !== except) reset()
  }
  const end = () => {
    item = undefined
    clear()
  }
  const bind = (surface: Document) => {
    const indicator = surface.createElement('div')
    indicator.setAttribute('data-freeflow-drop-indicator', '')
    indicator.style.cssText =
      'display:none;position:fixed;pointer-events:none;z-index:2147483647;box-sizing:border-box;border:2px solid #7952ed;background:#7952ed16;'
    const label = surface.createElement('span')
    label.style.cssText =
      'position:absolute;left:0;top:0;transform:translateY(-100%);padding:3px 6px;background:#7952ed;color:white;font:12px sans-serif;white-space:nowrap;border-radius:3px;'
    indicator.append(label)
    surface.body.append(indicator)
    let preview: ReturnType<typeof createDragPreview>
    let previewItem: DragItem | undefined
    const reset = () => {
      indicator.style.display = 'none'
      preview?.clear()
      if (!item) {
        preview?.dispose()
        preview = undefined
        previewItem = undefined
      }
    }
    clearers.add(reset)
    const onCanvas = !!surface.defaultView?.frameElement
    const elementAt = (event: DragEvent) =>
      (event.target as Element | null)?.closest?.<HTMLElement>(
        '[data-drag-preset], [data-drag-node], [data-freeflow-node]',
      )
    // The canvas hit-tests real geometry; layer rows are a plain vertical list.
    const locate = (event: DragEvent) => {
      const { doc, root, disabled } = getOptions()
      if (!item || !doc || !root || disabled) return
      if (onCanvas) return canvasDropTarget(surface, doc, root, item, event.clientX, event.clientY)
      const element = elementAt(event)
      const id = element?.dataset.dragNode
      if (!element || !id) return
      const rect = element.getBoundingClientRect()
      const fraction = (event.clientY - rect.top) / Math.max(1, rect.height)
      const inside = canContain(doc, id) && (id === root || (fraction > 0.25 && fraction < 0.75))
      const leading = fraction < 0.5
      const position: DropPosition = inside ? 'inside' : leading ? 'before' : 'after'
      try {
        const destination = dropTarget(doc, root, item, id, position)
        return { ...destination, id, position, rect, horizontal: false, leading }
      } catch {
        return
      }
    }
    const ensurePreview = () => {
      const { doc, siteId } = getOptions()
      if (previewItem !== item && doc) {
        preview?.dispose()
        preview = createDragPreview(surface, doc, item!, siteId)
        previewItem = item
      }
      return preview
    }
    const start = (event: DragEvent) => {
      end()
      const { doc, root, disabled } = getOptions()
      const element = elementAt(event)
      if (!element) return
      if (!doc || disabled || !event.dataTransfer) {
        event.preventDefault()
        return
      }
      const preset = element.dataset.dragPreset as Preset | undefined
      const id = element.dataset.dragNode ?? element.dataset.freeflowNode
      if (preset)
        item = {
          preset,
          classId: element.dataset.dragClass ?? '',
          assetId: element.dataset.dragAsset ?? '',
        }
      else if (id && id !== root && doc.nodes[id]?.parent && !structureRestriction(doc, id))
        item = { id }
      if (!item) {
        event.preventDefault()
        return
      }
      event.dataTransfer.effectAllowed = 'preset' in item ? 'copy' : 'move'
      event.dataTransfer.setData('application/x-freeflow-element', 'internal')
    }
    const isFileDrop = (event: DragEvent) => event.dataTransfer?.types.includes('Files')
    const imageTarget = (event: DragEvent) => {
      const { doc, disabled } = getOptions()
      const element = elementAt(event)
      const id = element?.dataset.freeflowNode
      const node = id && doc?.nodes[id]
      if (
        !disabled &&
        doc &&
        element &&
        id &&
        node &&
        node.type === 'element' &&
        node.tag === 'img' &&
        !structureRestriction(doc, id)
      )
        return { element, id }
    }
    const over = (event: DragEvent) => {
      if (isFileDrop(event)) {
        event.preventDefault()
        clear()
        const target = imageTarget(event)
        if (event.dataTransfer) event.dataTransfer.dropEffect = target ? 'copy' : 'none'
        if (target) {
          const rect = target.element.getBoundingClientRect()
          Object.assign(indicator.style, {
            display: 'block',
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          })
          label.textContent = 'Drop photo to replace image'
        }
        return
      }
      if (!item) return
      event.preventDefault()
      const target = locate(event)
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = target ? ('preset' in item ? 'copy' : 'move') : 'none'
      if (!target) {
        clear()
        return
      }
      const projection = onCanvas && ensurePreview()
      if (projection) {
        clear(reset)
        indicator.style.display = 'none'
        projection.show(target)
        return
      }
      clear()
      const { rect, position, horizontal, leading, id } = target
      const doc = getOptions().doc!
      const inside = position === 'inside'
      Object.assign(indicator.style, {
        display: 'block',
        left: `${rect.left + (!inside && horizontal && !leading ? rect.width : 0)}px`,
        top: `${rect.top + (!inside && !horizontal && !leading ? rect.height : 0)}px`,
        width: `${!inside && horizontal ? 3 : rect.width}px`,
        height: `${!inside && !horizontal ? 3 : rect.height}px`,
      })
      const node = doc.nodes[id]!
      label.textContent = `${position === 'inside' ? 'Inside' : position === 'before' ? 'Before' : 'After'} ${node.meta?.label ?? ('tag' in node ? node.tag : node.type)}`
    }
    const drop = (event: DragEvent) => {
      if (isFileDrop(event)) {
        event.preventDefault()
        event.stopPropagation()
        const target = imageTarget(event)
        const file = event.dataTransfer?.files[0]
        end()
        if (target && file) getOptions().uploadImage(target.id, file)
        return
      }
      if (!item) return
      event.preventDefault()
      event.stopPropagation()
      const target = locate(event)
      const source = item
      const { doc, root, save, select } = getOptions()
      if (!target || !doc || !root) {
        end()
        return
      }
      const edit = dropEdit(doc, root, source, target.id, target.position)
      // Keep the last projection while the save is in flight instead of snapping back on drop.
      const pending = edit.operations.length ? preview : undefined
      if (pending) preview = undefined
      end()
      if (edit.operations.length)
        void save(edit.operations)
          .then((saved) => {
            if (saved) select(edit.node.id)
          })
          .finally(() => pending?.dispose())
    }
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) reset()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') end()
    }
    surface.addEventListener('dragstart', start, true)
    surface.addEventListener('dragenter', over, true)
    surface.addEventListener('dragover', over, true)
    surface.addEventListener('drop', drop, true)
    surface.addEventListener('dragend', end, true)
    surface.addEventListener('dragleave', leave, true)
    surface.addEventListener('keydown', key, true)
    return () => {
      surface.removeEventListener('dragstart', start, true)
      surface.removeEventListener('dragenter', over, true)
      surface.removeEventListener('dragover', over, true)
      surface.removeEventListener('drop', drop, true)
      surface.removeEventListener('dragend', end, true)
      surface.removeEventListener('dragleave', leave, true)
      surface.removeEventListener('keydown', key, true)
      clearers.delete(reset)
      preview?.dispose()
      indicator.remove()
      end()
    }
  }
  return { bind }
}
