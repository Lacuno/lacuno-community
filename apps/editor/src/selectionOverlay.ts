import type { State } from '@freeflow/schema'
import {
  type ColorEdit,
  type Hsl,
  nearestSwatch,
  parseColor,
  type Swatch,
  thumbPosition,
  toHex,
  WHEEL_SIZE,
  wheelBackground,
  wheelColor,
} from './colorWheel.js'
import { STATES, stateInfo } from './states.js'

export type Selection = {
  name: string
  /** The breakpoint being edited, as shown to the designer. */
  scope: string
  state: State
  states: State[]
  /** The colour property the swatch edits for this element. */
  colorProperty: string
  swatches: Swatch[]
}

/** The colour menu's open state, kept by the caller so it survives a commit's canvas re-render. */
export type ColorMenu = { open: boolean; hsl?: Hsl }

const svg = (icon: string) =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`

/**
 * Editor-only selection chrome, isolated from site styles. A top bar (name, breakpoint, state)
 * and a bottom bar (colour) frame the selected element with the controls that belong on the
 * canvas. The colour menu's open state lives in `menu` so it stays open across a commit.
 */
export function selectionOverlay(
  doc: Document,
  latest: () => Selection,
  setState: (state: State) => void,
  onColor: (edit: ColorEdit) => void,
  menu: { get: () => ColorMenu; set: (state: ColorMenu) => void },
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
    .bar { position:absolute;display:flex;align-items:stretch;max-width:420px;border:1px solid white;border-radius:6px;background:#6434d9;color:white;box-shadow:0 2px 8px #0004;overflow:hidden; }
    .name { padding:4px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .scope { padding:4px 8px;border-left:1px solid #ffffff55;color:#ffffffcc;font-weight:500;white-space:nowrap; }
    .bar button { pointer-events:auto;display:flex;align-items:center;gap:5px;padding:4px 8px;border:0;border-left:1px solid #ffffff55;background:#ffffff22;color:inherit;font:inherit;cursor:pointer;white-space:nowrap; }
    .bar-bottom button { border-left:0; }
    .bar button:hover, .bar button[aria-expanded="true"] { background:#ffffff44; }
    .state.active { background:white;color:#6434d9; }
    .swatch i { display:block;width:14px;height:14px;border-radius:50%;border:1px solid #ffffffaa;box-shadow:inset 0 0 0 1px #0002; }
    .menu { pointer-events:auto;position:absolute;box-sizing:border-box;padding:4px;border-radius:8px;background:white;color:#1f1533;box-shadow:0 6px 24px #0004;font-weight:400; }
    .menu[hidden], .menu button[hidden] { display:none; }
    .state-menu { min-width:220px; }
    .state-menu button { display:flex;align-items:center;gap:10px;width:100%;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer; }
    .state-menu button:hover, .state-menu button:focus-visible { background:#f1ecfd;outline:none; }
    .state-menu button[aria-checked="true"] { background:#6434d9;color:white; }
    .state-menu button[aria-checked="true"] small { color:#ffffffcc; }
    .state-menu strong { display:block;font-weight:600; }
    .state-menu small { display:block;color:#655484;font-size:10px; }
    .color-menu { display:grid;grid-template-columns:minmax(0, 1fr);gap:8px;padding:12px;width:${WHEEL_SIZE + 24}px; }
    .color-menu > * { min-width:0; }
    .color-menu[hidden] { display:none; }
    .wheel { position:relative;width:${WHEEL_SIZE}px;height:${WHEEL_SIZE}px;border-radius:50%;cursor:crosshair;touch-action:none;box-shadow:inset 0 0 0 1px #0002; }
    .wheel-thumb { position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;border:2px solid white;box-shadow:0 0 0 1px #0006;pointer-events:none; }
    .color-menu label { display:grid;gap:2px;font-size:10px;color:#655484; }
    .color-menu input[type=range] { display:block;width:100%;min-width:0;margin:0;box-sizing:border-box; }
    .readout { display:flex;align-items:center;gap:6px;min-height:16px; }
    .readout i { width:14px;height:14px;border-radius:50%;border:1px solid #0002;flex-shrink:0; }
    .save { display:flex;gap:4px;min-width:0; }
    .save input { flex:1;min-width:0;padding:4px 6px;border:1px solid #d9d2ea;border-radius:4px;font:inherit;font-weight:400; }
    .save button { flex-shrink:0;padding:4px 8px;border:0;border-radius:4px;background:#6434d9;color:white;font:inherit;cursor:pointer; }
    .save button:disabled { opacity:.5;cursor:default; }
    @keyframes selection-march { to { stroke-dashoffset:-10; } }
    @media(prefers-reduced-motion:reduce) { .selection-dashes { animation:none; } }
  </style><svg class="frame"><rect class="selection-base"/><rect class="selection-dashes"/></svg>
  <div class="bar bar-top selection-label"><span class="name"></span><span class="scope"></span><button class="state" type="button" aria-haspopup="menu" aria-expanded="false"></button></div>
  <div class="bar bar-bottom"><button class="swatch" type="button" aria-haspopup="dialog" aria-expanded="false"><i></i></button></div>
  <div class="menu state-menu" role="menu" aria-label="Element state" hidden>${Object.entries(
    STATES,
  )
    .map(
      ([value, info]) =>
        `<button type="button" role="menuitemradio" aria-checked="false" data-state="${value}">${svg(info.icon)}<span><strong>${info.label}</strong><small>${info.hint}</small></span></button>`,
    )
    .join('')}</div>
  <div class="menu color-menu" role="dialog" aria-label="Color" hidden>
    <div class="wheel" role="slider" aria-label="Color wheel" tabindex="0"><div class="wheel-thumb"></div></div>
    <label>Saturation<input class="saturation" type="range" min="0" max="100" aria-label="Saturation"></label>
    <div class="readout"><i></i><span class="color-name"></span></div>
    <form class="save"><input type="text" placeholder="Save as project color…" aria-label="Project color name" maxlength="40"><button type="submit" disabled>Save</button></form>
  </div>`
  doc.body.append(host)
  const rects = shadow.querySelectorAll('rect')
  const topBar = shadow.querySelector<HTMLElement>('.bar-top')!
  const bottomBar = shadow.querySelector<HTMLElement>('.bar-bottom')!
  const name = shadow.querySelector<HTMLElement>('.name')!
  const scope = shadow.querySelector<HTMLElement>('.scope')!
  const chip = shadow.querySelector<HTMLButtonElement>('.state')!
  const swatch = shadow.querySelector<HTMLButtonElement>('.swatch')!
  const swatchDot = swatch.querySelector<HTMLElement>('i')!
  const stateMenu = shadow.querySelector<HTMLElement>('.state-menu')!
  const colorMenu = shadow.querySelector<HTMLElement>('.color-menu')!
  const wheel = shadow.querySelector<HTMLElement>('.wheel')!
  const thumb = shadow.querySelector<HTMLElement>('.wheel-thumb')!
  const saturation = shadow.querySelector<HTMLInputElement>('.saturation')!
  const readoutDot = shadow.querySelector<HTMLElement>('.readout i')!
  const readoutName = shadow.querySelector<HTMLElement>('.color-name')!
  const saveForm = shadow.querySelector<HTMLFormElement>('.save')!
  const saveName = saveForm.querySelector<HTMLInputElement>('input')!
  const saveButton = saveForm.querySelector<HTMLButtonElement>('button')!

  // Which menu is open, and the anchor bar it hangs off.
  let open: { el: HTMLElement; anchor: HTMLElement } | undefined
  let shown = ''
  // Start from the current selection so the first paint is not mistaken for a selection change.
  let element: Element | null = doc.querySelector('[data-freeflow-selected]')
  let current: Hsl = { h: 0, s: 1, l: 0.5 }
  let snapped: Swatch | undefined
  const closeMenus = () => {
    stateMenu.hidden = true
    colorMenu.hidden = true
    chip.setAttribute('aria-expanded', 'false')
    swatch.setAttribute('aria-expanded', 'false')
    open = undefined
  }
  const openState = () => {
    closeMenus()
    stateMenu.hidden = false
    chip.setAttribute('aria-expanded', 'true')
    open = { el: stateMenu, anchor: topBar }
    stateMenu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }
  const showColor = (hsl: Hsl) => {
    current = hsl
    snapped = nearestSwatch(hsl, latest().swatches)
    const hex = snapped?.value ?? toHex(hsl)
    readoutDot.style.background = hex
    readoutName.textContent = snapped ? snapped.name : hex
    saveButton.disabled = !!snapped || !saveName.value.trim()
    const at = thumbPosition(hsl)
    thumb.style.left = `${at.x * 100}%`
    thumb.style.top = `${at.y * 100}%`
    wheel.style.background = wheelBackground(hsl.s)
  }
  const openColor = (hsl: Hsl) => {
    closeMenus()
    colorMenu.hidden = false
    swatch.setAttribute('aria-expanded', 'true')
    open = { el: colorMenu, anchor: bottomBar }
    saturation.value = String(Math.round((hsl.s || 1) * 100))
    saveName.value = ''
    colorDirty = false
    showColor(hsl)
    menu.set({ open: true, hsl })
  }

  chip.addEventListener('click', (event) => {
    event.stopPropagation()
    if (open?.el === stateMenu) closeMenus()
    else openState()
  })
  stateMenu.addEventListener('click', (event) => {
    const item = (event.target as Element).closest<HTMLElement>('[data-state]')
    if (!item) return
    event.stopPropagation()
    closeMenus()
    setState(item.dataset.state as State)
  })

  const currentColor = () => {
    const property = latest().colorProperty
    return element ? view.getComputedStyle(element).getPropertyValue(property) : ''
  }
  const edit = (phase: 'drag' | 'commit') =>
    onColor({
      property: latest().colorProperty,
      value: snapped
        ? { type: 'designToken', ref: snapped.id }
        : { type: 'color', value: toHex(current) },
      phase,
    })
  swatch.addEventListener('click', (event) => {
    event.stopPropagation()
    if (open?.el === colorMenu) {
      commitColor()
      closeMenus()
      menu.set({ open: false })
      return
    }
    openColor(parseColor(currentColor()) ?? { h: 0, s: 1, l: 0.5 })
  })

  let dragging = false
  let colorDirty = false
  const commitColor = () => {
    if (!colorDirty) return
    colorDirty = false
    edit('commit')
  }
  const track = (event: { clientX: number; clientY: number }) => {
    colorDirty = true
    showColor(wheelColor(wheel, event.clientX, event.clientY, Number(saturation.value) / 100))
    menu.set({ open: true, hsl: current })
    edit('drag')
  }
  const release = () => {
    if (!dragging) return
    dragging = false
    doc.removeEventListener('pointerup', release)
    doc.removeEventListener('mouseup', release)
  }
  wheel.addEventListener('pointerdown', (event) => {
    event.stopPropagation()
    dragging = true
    wheel.setPointerCapture(event.pointerId)
    // Release listens on the document too: a captured pointer's up event is not always delivered.
    doc.addEventListener('pointerup', release)
    doc.addEventListener('mouseup', release)
    track(event)
  })
  wheel.addEventListener('pointermove', (event) => {
    if (dragging) track(event)
  })
  saturation.addEventListener('input', () => {
    colorDirty = true
    showColor({ ...current, s: Number(saturation.value) / 100 })
    menu.set({ open: true, hsl: current })
    edit('drag')
  })
  saveName.addEventListener('input', () => {
    saveButton.disabled = !!snapped || !saveName.value.trim()
  })
  saveForm.addEventListener('submit', (event) => {
    event.preventDefault()
    if (snapped || !saveName.value.trim()) return
    onColor({
      property: latest().colorProperty,
      token: { name: saveName.value.trim(), value: toHex(current) },
    })
    closeMenus()
    menu.set({ open: false })
  })

  const outside = (event: Event) => {
    if (open && !event.composedPath().includes(host)) {
      commitColor()
      closeMenus()
      menu.set({ open: false })
    }
  }
  const key = (event: KeyboardEvent) => {
    if (!open || event.key !== 'Escape') return
    event.stopPropagation()
    const opener = open.el === stateMenu ? chip : swatch
    commitColor()
    closeMenus()
    menu.set({ open: false })
    opener.focus()
  }
  doc.addEventListener('pointerdown', outside, true)
  host.addEventListener('keydown', key)

  // Reopen the colour menu the caller left open, so a commit's re-render does not close it.
  const restore = menu.get()
  if (restore.open) openColor(restore.hsl ?? { h: 0, s: 1, l: 0.5 })

  const placeBar = (bar: HTMLElement, left: number, top: number) => {
    bar.style.left = `${Math.max(2, Math.min(left, view.innerWidth - bar.offsetWidth - 2))}px`
    bar.style.top = `${top}px`
  }
  let frame = 0
  const paint = () => {
    const selected = doc.querySelector('[data-freeflow-selected]')
    // Close only when the selection moves to a different element, not while it is briefly
    // absent during the iframe reload a commit triggers.
    if (selected && selected !== element) {
      element = selected
      closeMenus()
      menu.set({ open: false })
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
      const selection = latest()
      const info = stateInfo(selection.state)
      const key = `${selection.name}|${selection.scope}|${selection.state}|${selection.states.join()}`
      if (key !== shown) {
        shown = key
        name.textContent = selection.name || selected!.tagName.toLowerCase()
        scope.textContent = selection.scope
        chip.innerHTML = `${svg(info.icon)}${info.label}`
        chip.setAttribute('aria-label', `State: ${info.label}`)
        chip.classList.toggle('active', selection.state !== 'none')
        for (const item of stateMenu.querySelectorAll<HTMLElement>('[data-state]')) {
          item.setAttribute('aria-checked', String(item.dataset.state === selection.state))
          item.hidden = !selection.states.includes(item.dataset.state as State)
        }
      }
      if (!dragging) {
        const color = currentColor()
        swatchDot.style.background = color
        swatch.setAttribute(
          'aria-label',
          `${selection.colorProperty === 'color' ? 'Text color' : 'Background color'}: ${color}`,
        )
      }
      for (const rect of rects) {
        rect.setAttribute('x', String(bounds.left))
        rect.setAttribute('y', String(bounds.top))
        rect.setAttribute('width', String(bounds.width))
        rect.setAttribute('height', String(bounds.height))
      }
      // Top bar above the element (below when there is no room); bottom bar below (above when not).
      const topFits = bounds.top - topBar.offsetHeight - 4 >= 2
      placeBar(topBar, bounds.left, topFits ? bounds.top - topBar.offsetHeight - 4 : bounds.top + 4)
      const bottomFits = bounds.bottom + bottomBar.offsetHeight + 4 <= view.innerHeight - 2
      placeBar(
        bottomBar,
        bounds.left,
        bottomFits ? bounds.bottom + 4 : bounds.bottom - bottomBar.offsetHeight - 4,
      )
      if (open) {
        const anchor = open.anchor.getBoundingClientRect()
        const under = anchor.bottom + 4
        const fits = under + open.el.offsetHeight <= view.innerHeight - 4
        open.el.style.left = `${Math.max(4, Math.min(anchor.left, view.innerWidth - open.el.offsetWidth - 4))}px`
        open.el.style.top = `${fits ? under : Math.max(4, anchor.top - open.el.offsetHeight - 4)}px`
      }
    }
    // When not visible the host is hidden but the menu stays open, so it returns after a reload.
    frame = view.requestAnimationFrame(paint)
  }
  paint()
  return () => {
    view.cancelAnimationFrame(frame)
    doc.removeEventListener('pointerdown', outside, true)
    host.remove()
  }
}
