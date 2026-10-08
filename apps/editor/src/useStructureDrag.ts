import type { Operation } from '@lacuno/document'
import type { Document as SiteDocument } from '@lacuno/schema'
import { useEffect, useRef } from 'react'
import {
  canvasSlots,
  type DropSlot,
  DWELL,
  insertionLine,
  layerDepth,
  layerSlots,
} from './dragTarget.js'
import {
  type DragItem,
  dropEdit,
  nodeLabel,
  type Preset,
  structureRestriction,
} from './structure.js'

type Options = {
  siteId: string
  doc: SiteDocument | undefined
  root: string | undefined
  disabled: boolean
  /** Saves what a panel still holds as a draft before a drop, so a draft never refuses a drag. */
  flush?: () => Promise<boolean>
  /** Where a refused drag says why. */
  notice?: (reason: string) => void
  save: (operations: Operation[]) => Promise<boolean>
  uploadImage: (id: string, file: File) => void
  select: (id: string) => void
}

type Rect = { left: number; top: number; width: number; height: number }

const ACCENT = '#7952ed'

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

/**
 * Nothing on the page moves while dragging: the dragged element dims in place, a label follows the
 * pointer, and the target container's outline and an insertion line show where it will land. The
 * document changes once, on drop.
 */
function createController(getOptions: () => Options) {
  let item: DragItem | undefined
  // Where a drag from a layer row started, so moving sideways from there changes its depth.
  let grab: { surface: Document; x: number; depth: number } | undefined
  const surfaces = new Map<Document, () => void>()
  const end = () => {
    item = undefined
    grab = undefined
    for (const [surface, reset] of surfaces) {
      reset()
      for (const element of surface.querySelectorAll('[data-lacuno-dragging]'))
        element.removeAttribute('data-lacuno-dragging')
    }
  }
  const bind = (surface: Document) => {
    const view = surface.defaultView!
    const frame = view.frameElement as HTMLElement | null
    const indicator = surface.createElement('div')
    indicator.setAttribute('data-lacuno-drop-indicator', '')
    // A unique id keeps the canvas morph from matching a server node against the indicator.
    indicator.id = 'lacuno-drop-indicator'
    indicator.style.cssText =
      'display:none;position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
    const style = surface.createElement('style')
    style.textContent = '[data-lacuno-dragging] { opacity: .4 !important; }'
    const outline = surface.createElement('div')
    const line = surface.createElement('div')
    outline.setAttribute('data-lacuno-drop-parent', '')
    line.setAttribute('data-lacuno-insertion', '')
    const label = surface.createElement('span')
    indicator.append(style, outline, line, label)
    surface.body.append(indicator)
    // Chrome draws on the canvas at its zoom; divide by it to keep the lines crisp and thin.
    const zoom = () => (frame ? frame.getBoundingClientRect().width / frame.offsetWidth || 1 : 1)
    const place = (element: HTMLElement, rect: Rect | undefined, css: string) => {
      element.hidden = !rect
      if (rect)
        element.style.cssText = `position:absolute;box-sizing:border-box;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;${css}`
    }
    const show = (
      container: Rect | undefined,
      bar: Rect | undefined,
      name: string,
      fill = false,
    ) => {
      const px = 1 / zoom()
      indicator.style.display = 'block'
      surface.documentElement.setAttribute('data-lacuno-dropping', '')
      place(
        outline,
        container,
        `border:${px}px dashed #9a94aa88;border-radius:${2 * px}px;background:${fill ? `${ACCENT}0c` : 'none'}`,
      )
      place(line, bar, `background:${ACCENT};border-radius:${px}px`)
      label.hidden = !name
      label.textContent = name
      // The label sits on the target's corner; a refusal, with no target, follows the pointer.
      const at = container ?? { left: pointer!.x + 12, top: pointer!.y + 12 }
      label.style.cssText = `position:absolute;left:${at.left}px;top:${Math.max(0, at.top)}px;padding:${2 * px}px ${6 * px}px;background:#fff;color:#615675;border:${px}px solid #e4dfed;font:500 ${11 * px}px/1.4 system-ui,sans-serif;border-radius:${4 * px}px;white-space:nowrap`
    }
    let target: { parent: string; index: number } | DropSlot | undefined
    let pointer: { x: number; y: number; over: Element | null } | undefined
    let canvas: { doc: SiteDocument; slots: ReturnType<typeof canvasSlots> } | undefined
    let layers:
      | { doc: SiteDocument; panel: HTMLElement; slots: ReturnType<typeof layerSlots> }
      | undefined
    let dwell: ReturnType<typeof setTimeout> | undefined
    let scrolling = 0
    const hide = () => {
      target = undefined
      indicator.style.display = 'none'
      surface.documentElement.removeAttribute('data-lacuno-dropping')
    }
    const reset = () => {
      hide()
      pointer = undefined
      canvas = undefined
      layers = undefined
      clearTimeout(dwell)
      view.cancelAnimationFrame(scrolling)
    }
    surfaces.set(surface, reset)
    const update = () => {
      const { doc, root, disabled } = getOptions()
      if (!item || !pointer || !doc || !root || disabled) return hide()
      if (frame) {
        if (canvas?.doc !== doc) canvas = { doc, slots: canvasSlots(surface, doc, root, item) }
        const slot = canvas.slots.locate(pointer.x, pointer.y)
        if (!slot) {
          // Nothing here takes the item: the reason stands where the target's name would.
          const reason = canvas.slots.refusal(pointer.x, pointer.y)
          hide()
          if (reason) show(undefined, undefined, reason)
          return
        }
        target = slot
        const sibling = slot.wrap ? canvas.slots.box(slot.wrap) : undefined
        const px = 1 / zoom()
        const name = (id: string) => (id === root ? 'Body' : nodeLabel(doc.nodes[id]!))
        if (sibling) {
          show(
            sibling,
            {
              left: (slot.first ? sibling.left : sibling.right) - px,
              top: sibling.top,
              width: 2 * px,
              height: sibling.height,
            },
            `Row with ${name(slot.wrap!)}`,
          )
        } else {
          // What resting would do is said before it happens, so a quick release surprises no one.
          const { pending } = slot
          show(
            canvas.slots.box(slot.parent)!,
            insertionLine(slot, pointer.y, 2 * px),
            !pending
              ? name(slot.parent)
              : pending.wrap
                ? `Hold for a Row with ${name(pending.id)}`
                : `Hold to drop inside ${name(pending.id)}`,
            !slot.boxes.length,
          )
        }
        return
      }
      const panel = pointer.over?.closest<HTMLElement>('.navigator')
      if (!panel) return hide()
      if (layers?.doc !== doc || layers.panel !== panel)
        layers = {
          doc,
          panel,
          slots: layerSlots(panel, doc, root, item, grab?.surface === surface ? grab : undefined),
        }
      const slot = layers.slots.locate(pointer.x, pointer.y)
      if (!slot) return hide()
      target = slot
      if ('row' in slot) {
        const { left, top, width, height } = slot.row.rect
        show({ left, top, width, height }, undefined, '', true)
      } else {
        const { left, top } = slot.line
        const width = panel.getBoundingClientRect().right - left
        show(undefined, { left, top: top - 1, width, height: 2 }, '')
      }
    }
    // Near the top or bottom edge, the canvas or the layers list scrolls, faster closer to it.
    const autoScroll = () => {
      view.cancelAnimationFrame(scrolling)
      const scroller = frame ? surface.scrollingElement : pointer?.over?.closest('.layer-list')
      if (!item || !pointer || !scroller) return
      const bounds = frame ? { top: 0, bottom: view.innerHeight } : scroller.getBoundingClientRect()
      const zone = 40
      const speed =
        pointer.y < bounds.top + zone
          ? pointer.y - bounds.top - zone
          : pointer.y > bounds.bottom - zone
            ? pointer.y - bounds.bottom + zone
            : 0
      if (!speed) return
      scrolling = view.requestAnimationFrame(() => {
        const before = scroller.scrollTop
        scroller.scrollTop += Math.round(speed / 2)
        if (scroller.scrollTop === before) return
        update()
        autoScroll()
      })
    }
    // The layout never moves during a drag; only a scroll changes where things are.
    const remeasure = () => {
      canvas?.slots.remeasure()
      layers?.slots.remeasure()
    }
    const elementAt = (event: DragEvent) =>
      (event.target as Element | null)?.closest?.<HTMLElement>(
        '[data-drag-preset], [data-drag-node], [data-lacuno-node]',
      )
    const start = (event: DragEvent) => {
      end()
      const { doc, root, disabled } = getOptions()
      const element = elementAt(event)
      if (!element) return
      if (!doc || !root || disabled || !event.dataTransfer) {
        event.preventDefault()
        return
      }
      const preset = element.dataset.dragPreset as Preset | undefined
      const movable = (id: string | undefined) =>
        !!id && id !== root && !!doc.nodes[id]?.parent && !structureRestriction(doc, id)
      // A press inside the selected element drags it, so a whole section moves from anywhere on it.
      const selected = frame
        ? element.closest('[data-lacuno-selected]')?.closest<HTMLElement>('[data-lacuno-node]')
            ?.dataset.lacunoNode
        : undefined
      const candidates = [selected, element.dataset.dragNode ?? element.dataset.lacunoNode]
      const id = candidates.find(movable)
      if (preset)
        item = {
          preset,
          classId: element.dataset.dragClass ?? '',
          assetId: element.dataset.dragAsset ?? '',
        }
      else if (id) item = { id }
      if (!item) {
        event.preventDefault()
        const pressed = candidates.find((each) => !!each)
        const reason = pressed && structureRestriction(doc, pressed)
        if (reason) getOptions().notice?.(reason)
        return
      }
      if (id && !preset) {
        for (const each of surfaces.keys())
          for (const source of each.querySelectorAll(
            `[data-lacuno-node="${CSS.escape(id)}"], [data-drag-node="${CSS.escape(id)}"]`,
          ))
            source.setAttribute('data-lacuno-dragging', '')
        if (element.dataset.dragNode)
          grab = { surface, x: event.clientX, depth: layerDepth(doc, root, id) }
        // On the canvas a small label follows the pointer instead of a picture of the element.
        if (frame) {
          const ghost = surface.createElement('div')
          ghost.textContent = nodeLabel(doc.nodes[id]!)
          ghost.style.cssText = `position:fixed;left:0;top:-100px;padding:4px 8px;background:${ACCENT};color:#fff;font:500 12px/1.4 system-ui,sans-serif;border-radius:4px;white-space:nowrap`
          surface.body.append(ghost)
          event.dataTransfer.setDragImage(ghost, -10, -10)
          setTimeout(() => ghost.remove())
        }
      }
      event.dataTransfer.effectAllowed = 'preset' in item ? 'copy' : 'move'
      event.dataTransfer.setData('application/x-lacuno-element', 'internal')
    }
    const isFileDrop = (event: DragEvent) => event.dataTransfer?.types.includes('Files')
    const imageTarget = (event: DragEvent) => {
      const { doc, disabled } = getOptions()
      const element = elementAt(event)
      const id = element?.dataset.lacunoNode
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
    // A drop zone of its own, such as the asset manager, takes its files itself.
    const ownDropZone = (event: DragEvent) =>
      event.target instanceof Element && !!event.target.closest('[data-file-drop]')
    const over = (event: DragEvent) => {
      if (ownDropZone(event)) return
      if (isFileDrop(event)) {
        event.preventDefault()
        const image = imageTarget(event)
        if (event.dataTransfer) event.dataTransfer.dropEffect = image ? 'copy' : 'none'
        if (image)
          show(
            image.element.getBoundingClientRect(),
            undefined,
            'Drop photo to replace image',
            true,
          )
        else hide()
        return
      }
      if (!item) return
      event.preventDefault()
      pointer = { x: event.clientX, y: event.clientY, over: event.target as Element | null }
      update()
      autoScroll()
      // Resting still settles a drop into the sibling under the pointer without another event.
      clearTimeout(dwell)
      dwell = setTimeout(update, DWELL + 20)
      if (event.dataTransfer)
        event.dataTransfer.dropEffect = target ? ('preset' in item ? 'copy' : 'move') : 'none'
    }
    const drop = async (event: DragEvent) => {
      if (ownDropZone(event)) return
      if (isFileDrop(event)) {
        event.preventDefault()
        event.stopPropagation()
        const image = imageTarget(event)
        const file = event.dataTransfer?.files[0]
        end()
        if (image && file) getOptions().uploadImage(image.id, file)
        return
      }
      if (!item) return
      event.preventDefault()
      event.stopPropagation()
      pointer = { x: event.clientX, y: event.clientY, over: event.target as Element | null }
      update()
      const source = item
      const slot = target
      const { flush } = getOptions()
      end()
      if (!slot) return
      // A draft still pending in a panel lands first, as its own step; one it cannot save stops
      // here. The session is read again after it, since the save it made changed the document.
      if (flush && !(await flush())) return
      const { doc, root, save, select } = getOptions()
      if (!doc || !root) return
      let edit: ReturnType<typeof dropEdit>
      try {
        const wrap =
          'wrap' in slot && slot.wrap ? { sibling: slot.wrap, first: !!slot.first } : undefined
        edit = dropEdit(doc, root, source, slot.parent, slot.index, wrap)
      } catch (error) {
        getOptions().notice?.((error as Error).message)
        return
      }
      const selected = () => {
        select(edit.node.id)
        // The overlay waits for the saved canvas and its selection marker before opening.
        if (frame)
          surface.dispatchEvent(
            new CustomEvent('lacuno:align-after-drop', { detail: edit.node.id }),
          )
      }
      if (edit.operations.length)
        void save(edit.operations).then((saved) => {
          if (saved) selected()
        })
      else selected()
    }
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) hide()
    }
    surface.addEventListener('dragstart', start, true)
    surface.addEventListener('dragenter', over, true)
    surface.addEventListener('dragover', over, true)
    surface.addEventListener('drop', drop, true)
    surface.addEventListener('dragend', end, true)
    surface.addEventListener('dragleave', leave, true)
    surface.addEventListener('scroll', remeasure, true)
    view.addEventListener('resize', remeasure)
    return () => {
      surface.removeEventListener('dragstart', start, true)
      surface.removeEventListener('dragenter', over, true)
      surface.removeEventListener('dragover', over, true)
      surface.removeEventListener('drop', drop, true)
      surface.removeEventListener('dragend', end, true)
      surface.removeEventListener('dragleave', leave, true)
      surface.removeEventListener('scroll', remeasure, true)
      view.removeEventListener('resize', remeasure)
      reset()
      surfaces.delete(surface)
      indicator.remove()
    }
  }
  return { bind }
}
