import type { Document as SiteDocument } from '@freeflow/schema'
import { useEffect, useRef } from 'react'
import type { EditOperation } from './history.js'
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
  doc: SiteDocument | undefined
  root: string | undefined
  disabled: boolean
  save: (operations: EditOperation[]) => Promise<boolean>
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
  const clear = () => {
    for (const reset of clearers) reset()
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
    const reset = () => {
      indicator.style.display = 'none'
    }
    clearers.add(reset)
    const elementAt = (event: DragEvent) =>
      (event.target as Element | null)?.closest?.<HTMLElement>(
        '[data-drag-preset], [data-drag-node], [data-freeflow-node]',
      )
    const resolve = (event: DragEvent) => {
      const { doc, root, disabled } = getOptions()
      const element = elementAt(event)
      const id = element?.dataset.dragNode ?? element?.dataset.freeflowNode
      if (!item || !doc || !root || disabled || !element || !id) return
      const rect = element.getBoundingClientRect()
      const parentStyle =
        element.parentElement && surface.defaultView?.getComputedStyle(element.parentElement)
      const horizontal =
        !element.dataset.dragNode &&
        (parentStyle?.display === 'grid' ||
          (parentStyle?.display === 'flex' && parentStyle.flexDirection.startsWith('row')))
      const reverse =
        !element.dataset.dragNode &&
        parentStyle?.display === 'flex' &&
        parentStyle.flexDirection.endsWith('reverse')
      const fraction = horizontal
        ? (event.clientX - rect.left) / Math.max(1, rect.width)
        : (event.clientY - rect.top) / Math.max(1, rect.height)
      const inside = canContain(doc, id) && (id === root || (fraction > 0.25 && fraction < 0.75))
      const leading = fraction < 0.5
      const position: DropPosition = inside ? 'inside' : leading !== !!reverse ? 'before' : 'after'
      try {
        dropTarget(doc, root, item, id, position)
      } catch {
        return
      }
      return { id, position, rect, horizontal, leading, doc }
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
      if (preset) item = { preset, classId: element.dataset.dragClass ?? '' }
      else if (id && id !== root && doc.nodes[id]?.parent && !structureRestriction(doc, id))
        item = { id }
      if (!item) {
        event.preventDefault()
        return
      }
      event.dataTransfer.effectAllowed = 'preset' in item ? 'copy' : 'move'
      event.dataTransfer.setData('application/x-freeflow-element', 'internal')
    }
    const over = (event: DragEvent) => {
      if (!item) return
      event.preventDefault()
      clear()
      const target = resolve(event)
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = target ? ('preset' in item ? 'copy' : 'move') : 'none'
      if (!target) return
      const { rect, position, horizontal, leading, id, doc } = target
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
      if (!item) return
      event.preventDefault()
      event.stopPropagation()
      const target = resolve(event)
      const source = item
      end()
      const { doc, root, save, select } = getOptions()
      if (!target || !doc || !root) return
      const edit = dropEdit(doc, root, source, target.id, target.position)
      if (edit.operations.length)
        void save(edit.operations).then((saved) => {
          if (saved) select(edit.node.id)
        })
    }
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) reset()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') end()
    }
    surface.addEventListener('dragstart', start, true)
    surface.addEventListener('dragover', over, true)
    surface.addEventListener('drop', drop, true)
    surface.addEventListener('dragend', end, true)
    surface.addEventListener('dragleave', leave, true)
    surface.addEventListener('keydown', key, true)
    return () => {
      surface.removeEventListener('dragstart', start, true)
      surface.removeEventListener('dragover', over, true)
      surface.removeEventListener('drop', drop, true)
      surface.removeEventListener('dragend', end, true)
      surface.removeEventListener('dragleave', leave, true)
      surface.removeEventListener('keydown', key, true)
      clearers.delete(reset)
      indicator.remove()
      end()
    }
  }
  return { bind }
}
