import type { Document as SiteDocument } from '@lacuno/schema'
import { dragInsertion } from './dragInsertion.js'
import type { DragItem } from './structure.js'

type DragDestination = { parent: string; index: number; id: string }

/** A sandboxed visual projection; the real canvas and its hit geometry never move. */
export function createDragPreview(
  surface: Document,
  doc: SiteDocument,
  item: DragItem,
  siteId: string,
  grab: { x: number; y: number },
) {
  const view = surface.defaultView
  const canvas = view?.frameElement as HTMLIFrameElement | null
  if (!view || !canvas || !surface.querySelector('[data-lacuno-node]')) return
  const owner = canvas.ownerDocument
  const frame = owner.createElement('iframe')
  frame.title = 'Drag preview'
  frame.setAttribute('sandbox', 'allow-same-origin')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.inert = true
  const size = () => {
    frame.style.cssText = canvas.style.cssText
    Object.assign(frame.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      pointerEvents: 'none',
      zIndex: '1',
      border: '0',
    })
  }
  let active = false
  size()
  canvas.after(frame)
  const projection = frame.contentDocument!
  projection.replaceChild(
    projection.importNode(surface.documentElement, true),
    projection.documentElement,
  )
  // Never copy editor chrome or executable content into the visual-only layer.
  for (const element of projection.querySelectorAll(
    'script, [data-lacuno-selection-overlay], [data-lacuno-drop-indicator], [data-lacuno-sort-gap]',
  ))
    element.remove()
  for (const element of projection.querySelectorAll('[data-lacuno-selected]'))
    element.removeAttribute('data-lacuno-selected')
  const find = (id: string) =>
    projection.querySelector<HTMLElement>(`[data-lacuno-node="${CSS.escape(id)}"]`)
  const source = 'id' in item ? find(item.id) : dragInsertion(projection, doc, item, siteId)
  if (!source) {
    frame.remove()
    return
  }
  // Chrome paints the native drag image at the element's unscaled size, ignoring the canvas zoom,
  // so the canvas hides it and the dragged element is drawn here at its size on the canvas instead.
  let ghost: HTMLElement | undefined
  if ('id' in item) {
    ghost = source.cloneNode(true) as HTMLElement
    for (const element of [ghost, ...ghost.querySelectorAll('[data-lacuno-node]')])
      element.removeAttribute('data-lacuno-node')
    ghost.setAttribute('data-lacuno-drag-ghost', '')
    const { width, height } = surface
      .querySelector(`[data-lacuno-node="${CSS.escape(item.id)}"]`)!
      .getBoundingClientRect()
    ghost.style.cssText += `;position:fixed!important;width:${width}px!important;height:${height}px!important;margin:0!important;box-sizing:border-box!important;translate:none!important;opacity:.75!important;pointer-events:none;z-index:2147483647`
    source.before(ghost)
  }
  const originalParent = source.parentElement
  const originalNext = source.nextSibling
  const originalStyle = surface.documentElement.getAttribute('style')
  const marker = surface.createElement('div')
  marker.setAttribute('data-lacuno-sort-gap', '')
  marker.hidden = true
  const sourceStyle = source.getAttribute('style')
  const elements = [...projection.querySelectorAll<HTMLElement>('[data-lacuno-node]')]
  let animations: Animation[] = []
  let destination = ''
  let disposed = false
  const restoreSource = () => {
    if (sourceStyle === null) source.removeAttribute('style')
    else source.setAttribute('style', sourceStyle)
  }
  const syncScroll = () => {
    frame.contentWindow?.scrollTo(view.scrollX, view.scrollY)
    for (const element of surface.querySelectorAll<HTMLElement>('[data-lacuno-node]')) {
      if (
        element.scrollHeight <= element.clientHeight &&
        element.scrollWidth <= element.clientWidth
      )
        continue
      const copy = find(element.dataset.lacunoNode!)
      if (copy) {
        copy.scrollTop = element.scrollTop
        copy.scrollLeft = element.scrollLeft
      }
    }
  }
  const stopAnimations = () => {
    for (const animation of animations) animation.cancel()
    animations = []
  }
  const clear = () => {
    if (!active) return
    stopAnimations()
    if (originalParent) originalParent.insertBefore(source, originalNext)
    else source.remove()
    restoreSource()
    if (originalStyle === null) surface.documentElement.removeAttribute('style')
    else surface.documentElement.setAttribute('style', originalStyle)
    marker.remove()
    active = false
    destination = ''
  }
  const resize = new ResizeObserver(() => {
    if (!disposed) {
      size()
      syncScroll()
    }
  })
  resize.observe(canvas)
  // Canvas zoom changes its transform without changing its unscaled content-box width.
  const zoom = new MutationObserver(size)
  zoom.observe(canvas, { attributes: true, attributeFilter: ['style'] })
  surface.addEventListener('scroll', syncScroll, true)
  syncScroll()
  return {
    follow(x: number, y: number) {
      ghost?.style.setProperty('left', `${x - grab.x}px`, 'important')
      ghost?.style.setProperty('top', `${y - grab.y}px`, 'important')
    },
    drop: () => ghost?.remove(),
    show(target: DragDestination) {
      const key = `${target.parent}:${target.index}`
      if (destination === key) return
      const parent = find(target.parent)
      if (!parent || source.contains(parent)) return
      syncScroll()
      const before = new Map(elements.map((element) => [element, element.getBoundingClientRect()]))
      stopAnimations()
      source.remove()
      const siblings = [...parent.children].filter((element) =>
        element.hasAttribute('data-lacuno-node'),
      )
      parent.insertBefore(source, siblings[target.index] ?? null)
      source.style.setProperty('opacity', '0', 'important')
      syncScroll()
      const after = new Map(elements.map((element) => [element, element.getBoundingClientRect()]))
      if (!view.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        for (const element of elements) {
          if (source.contains(element)) continue
          const first = before.get(element)!
          const last = after.get(element)!
          const ancestor = element.parentElement?.closest<HTMLElement>('[data-lacuno-node]')
          const parentBefore = ancestor && before.get(ancestor)
          const parentAfter = ancestor && after.get(ancestor)
          const dx =
            first.left -
            last.left -
            (parentBefore && parentAfter ? parentBefore.left - parentAfter.left : 0)
          const dy =
            first.top -
            last.top -
            (parentBefore && parentAfter ? parentBefore.top - parentAfter.top : 0)
          if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
          animations.push(
            element.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], {
              duration: 160,
              easing: 'ease-out',
              composite: 'add',
            }),
          )
        }
      }
      surface.documentElement.style.setProperty('opacity', '0', 'important')
      marker.dataset.destination = target.id
      marker.dataset.parent = target.parent
      marker.dataset.index = String(target.index)
      marker.dataset.source = source.dataset.lacunoNode
      surface.body.append(marker)
      active = true
      destination = key
    },
    clear,
    dispose() {
      if (disposed) return
      disposed = true
      clear()
      resize.disconnect()
      zoom.disconnect()
      surface.removeEventListener('scroll', syncScroll, true)
      frame.remove()
    },
  }
}
