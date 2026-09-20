/** Editor-only selection chrome, isolated from site styles and pointer events. */
export function selectionOverlay(doc: Document, name: () => string): () => void {
  const view = doc.defaultView
  if (!view) return () => {}
  const host = doc.createElement('div')
  host.setAttribute('data-freeflow-selection-overlay', '')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden;'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>
    :host { pointer-events: none; }
    svg { position:absolute;inset:0;width:100%;height:100%;overflow:hidden; }
    rect { fill:none;vector-effect:non-scaling-stroke; }
    .selection-base { stroke:white;stroke-width:3; }
    .selection-dashes { stroke:#6434d9;stroke-width:2;stroke-dasharray:5 5;animation:selection-march 1.2s linear infinite; }
    .selection-label { position:absolute;box-sizing:border-box;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:3px 7px;border:1px solid white;border-radius:4px;background:#6434d9;color:white;font:600 11px/16px system-ui,sans-serif;box-shadow:0 1px 4px #0003; }
    @keyframes selection-march { to { stroke-dashoffset:-10; } }
    @media(prefers-reduced-motion:reduce) { .selection-dashes { animation:none; } }
  </style><svg><rect class="selection-base"/><rect class="selection-dashes"/></svg><div class="selection-label"></div>`
  doc.body.append(host)
  const rects = shadow.querySelectorAll('rect')
  const label = shadow.querySelector<HTMLElement>('.selection-label')!
  let frame = 0
  const paint = () => {
    const element = doc.querySelector('[data-freeflow-selected]')
    const bounds = element?.getBoundingClientRect()
    const visible =
      !doc.querySelector('[data-freeflow-sort-gap]') &&
      bounds &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.bottom > 0 &&
      bounds.right > 0 &&
      bounds.top < view.innerHeight &&
      bounds.left < view.innerWidth
    host.style.display = visible ? 'block' : 'none'
    if (visible) {
      for (const rect of rects) {
        rect.setAttribute('x', String(bounds.left))
        rect.setAttribute('y', String(bounds.top))
        rect.setAttribute('width', String(bounds.width))
        rect.setAttribute('height', String(bounds.height))
      }
      label.textContent = name() || element!.tagName.toLowerCase()
      label.style.left = `${Math.max(2, Math.min(bounds.left, view.innerWidth - label.offsetWidth - 2))}px`
      label.style.top = `${bounds.top >= 28 ? bounds.top - 26 : Math.max(2, bounds.top + 3)}px`
    }
    frame = view.requestAnimationFrame(paint)
  }
  paint()
  return () => {
    view.cancelAnimationFrame(frame)
    host.remove()
  }
}
