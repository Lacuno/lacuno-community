import type { State } from '@freeflow/schema'
import { STATES, stateInfo } from './states.js'

const svg = (icon: string) =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`

/**
 * Editor-only selection chrome, isolated from site styles. The label carries the state chip:
 * every style change applies to the state it shows, and clicking it opens the state menu.
 */
export function selectionOverlay(
  doc: Document,
  latest: () => { name: string; state: State; states: State[] },
  setState: (state: State) => void,
): () => void {
  const view = doc.defaultView
  if (!view) return () => {}
  const host = doc.createElement('div')
  host.setAttribute('data-freeflow-selection-overlay', '')
  host.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:2147483646;overflow:hidden;'
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `<style>
    :host { pointer-events: none; font: 600 11px/16px system-ui, sans-serif; }
    svg.frame { position:absolute;inset:0;width:100%;height:100%;overflow:hidden; }
    rect { fill:none;vector-effect:non-scaling-stroke; }
    .selection-base { stroke:white;stroke-width:3; }
    .selection-dashes { stroke:#6434d9;stroke-width:2;stroke-dasharray:5 5;animation:selection-march 1.2s linear infinite; }
    .selection-label { position:absolute;display:flex;align-items:stretch;max-width:320px;border:1px solid white;border-radius:4px;background:#6434d9;color:white;box-shadow:0 1px 4px #0003;overflow:hidden; }
    .name { padding:3px 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .state { pointer-events:auto;display:flex;align-items:center;gap:4px;padding:3px 7px;border:0;border-left:1px solid #ffffff55;background:#ffffff22;color:inherit;font:inherit;cursor:pointer;white-space:nowrap; }
    .state:hover, .state[aria-expanded="true"] { background:#ffffff44; }
    .state.active { background:white;color:#6434d9; }
    .state-menu { pointer-events:auto;position:absolute;min-width:220px;padding:4px;border-radius:8px;background:white;color:#1f1533;box-shadow:0 6px 24px #0004;font-weight:400; }
    .state-menu[hidden], .state-menu button[hidden] { display:none; }
    .state-menu button { display:flex;align-items:center;gap:10px;width:100%;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer; }
    .state-menu button:hover, .state-menu button:focus-visible { background:#f1ecfd;outline:none; }
    .state-menu button[aria-checked="true"] { background:#6434d9;color:white; }
    .state-menu button[aria-checked="true"] small { color:#ffffffcc; }
    .state-menu strong { display:block;font-weight:600; }
    .state-menu small { display:block;color:#655484;font-size:10px; }
    @keyframes selection-march { to { stroke-dashoffset:-10; } }
    @media(prefers-reduced-motion:reduce) { .selection-dashes { animation:none; } }
  </style><svg class="frame"><rect class="selection-base"/><rect class="selection-dashes"/></svg>
  <div class="selection-label"><span class="name"></span><button class="state" type="button" aria-haspopup="menu" aria-expanded="false"></button></div>
  <div class="state-menu" role="menu" aria-label="Element state" hidden>${Object.entries(STATES)
    .map(
      ([value, info]) =>
        `<button type="button" role="menuitemradio" aria-checked="false" data-state="${value}">${svg(info.icon)}<span><strong>${info.label}</strong><small>${info.hint}</small></span></button>`,
    )
    .join('')}</div>`
  doc.body.append(host)
  const rects = shadow.querySelectorAll('rect')
  const label = shadow.querySelector<HTMLElement>('.selection-label')!
  const name = shadow.querySelector<HTMLElement>('.name')!
  const chip = shadow.querySelector<HTMLButtonElement>('.state')!
  const menu = shadow.querySelector<HTMLElement>('.state-menu')!
  let open = false
  let shown = ''
  let element: Element | null = null
  const toggle = (next: boolean) => {
    open = next
    menu.hidden = !open
    chip.setAttribute('aria-expanded', String(open))
    if (open) menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }
  chip.addEventListener('click', (event) => {
    event.stopPropagation()
    toggle(!open)
  })
  menu.addEventListener('click', (event) => {
    const item = (event.target as Element).closest<HTMLElement>('[data-state]')
    if (!item) return
    event.stopPropagation()
    toggle(false)
    setState(item.dataset.state as State)
  })
  const outside = (event: Event) => {
    if (open && !event.composedPath().includes(host)) toggle(false)
  }
  const key = (event: KeyboardEvent) => {
    if (!open || event.key !== 'Escape') return
    event.stopPropagation()
    toggle(false)
    chip.focus()
  }
  doc.addEventListener('pointerdown', outside, true)
  host.addEventListener('keydown', key)
  let frame = 0
  const paint = () => {
    const selected = doc.querySelector('[data-freeflow-selected]')
    if (selected !== element) {
      element = selected
      toggle(false)
    }
    const bounds = selected?.getBoundingClientRect()
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
      const current = latest()
      const info = stateInfo(current.state)
      const key = `${current.name}|${current.state}|${current.states.join()}`
      if (key !== shown) {
        shown = key
        name.textContent = current.name || selected!.tagName.toLowerCase()
        chip.innerHTML = `${svg(info.icon)}${info.label}`
        chip.setAttribute('aria-label', `State: ${info.label}`)
        chip.classList.toggle('active', current.state !== 'none')
        for (const item of menu.querySelectorAll<HTMLElement>('[data-state]')) {
          item.setAttribute('aria-checked', String(item.dataset.state === current.state))
          item.hidden = !current.states.includes(item.dataset.state as State)
        }
      }
      for (const rect of rects) {
        rect.setAttribute('x', String(bounds.left))
        rect.setAttribute('y', String(bounds.top))
        rect.setAttribute('width', String(bounds.width))
        rect.setAttribute('height', String(bounds.height))
      }
      const left = Math.max(2, Math.min(bounds.left, view.innerWidth - label.offsetWidth - 2))
      const top = bounds.top >= 28 ? bounds.top - 26 : Math.max(2, bounds.top + 3)
      label.style.left = `${left}px`
      label.style.top = `${top}px`
      const below = top + label.offsetHeight + 4
      const fits = below + menu.offsetHeight <= view.innerHeight - 4
      menu.style.left = `${Math.min(left, view.innerWidth - menu.offsetWidth - 4)}px`
      menu.style.top = `${fits ? below : Math.max(4, top - menu.offsetHeight - 4)}px`
    } else if (open) toggle(false)
    frame = view.requestAnimationFrame(paint)
  }
  paint()
  return () => {
    view.cancelAnimationFrame(frame)
    doc.removeEventListener('pointerdown', outside, true)
    host.remove()
  }
}
