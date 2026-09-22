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
  /** Whether this element takes a text colour, so the text swatch is offered. */
  textColor: boolean
  swatches: Swatch[]
}

const svg = (icon: string) =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`

// The two swatch icons: an "A" for text colour, a striped block for background colour.
const TEXT_ICON = '<path d="M3.5 13 8 3l4.5 10"/><path d="M5.5 9.5h5"/>'
const BACKGROUND_ICON =
  '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M4 10 10 4M7 13 13 7"/>'

/**
 * Editor-only selection chrome, isolated from site styles. A top bar (name, breakpoint, state)
 * and a bottom bar (colour) frame the selected element with the controls that belong on the
 * canvas. The overlay is installed once and outlives every render, so an open menu simply stays
 * open across a commit.
 */
export function selectionOverlay(
  doc: Document,
  latest: () => Selection,
  setState: (state: State) => void,
  onColor: (edit: ColorEdit) => void,
): () => void {
  const view = doc.defaultView
  if (!view) return () => {}
  const host = doc.createElement('div')
  host.setAttribute('data-freeflow-selection-overlay', '')
  // A unique id keeps the morph from ever matching a server node against this host.
  host.id = 'freeflow-selection-overlay'
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
    .bar button[hidden] { display:none; }
    .bar-bottom button { border-left:0; }
    .bar-bottom button + button { border-left:1px solid #ffffff55; }
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
    .swatches { display:flex;flex-wrap:wrap;gap:6px; }
    .swatches:empty { display:none; }
    .swatches button { width:22px;height:22px;padding:0;border:1px solid #0002;border-radius:50%;cursor:pointer; }
    .swatches button[aria-pressed="true"] { box-shadow:0 0 0 2px #6434d9; }
    .swatches-label:empty, .swatches-label.hidden { display:none; }
    .save { display:flex;gap:4px;min-width:0; }
    .save input { flex:1;min-width:0;padding:4px 6px;border:1px solid #d9d2ea;border-radius:4px;font:inherit;font-weight:400; }
    .save button { flex-shrink:0;padding:4px 8px;border:0;border-radius:4px;background:#6434d9;color:white;font:inherit;cursor:pointer; }
    .save button:disabled { opacity:.5;cursor:default; }
    @keyframes selection-march { to { stroke-dashoffset:-10; } }
    @media(prefers-reduced-motion:reduce) { .selection-dashes { animation:none; } }
  </style><svg class="frame"><rect class="selection-base"/><rect class="selection-dashes"/></svg>
  <div class="bar bar-top selection-label"><span class="name"></span><span class="scope"></span><button class="state" type="button" aria-haspopup="menu" aria-expanded="false"></button></div>
  <div class="bar bar-bottom"><button class="swatch text" type="button" aria-haspopup="dialog" aria-expanded="false">${svg(TEXT_ICON)}<i></i></button><button class="swatch background" type="button" aria-haspopup="dialog" aria-expanded="false">${svg(BACKGROUND_ICON)}<i></i></button></div>
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
    <label class="swatches-label">Project colors</label>
    <div class="swatches" role="listbox" aria-label="Project colors"></div>
    <form class="save"><input type="text" placeholder="Save as project color…" aria-label="Project color name" maxlength="40"><button type="submit" disabled>Save</button></form>
  </div>`
  doc.body.append(host)
  const rects = shadow.querySelectorAll('rect')
  const topBar = shadow.querySelector<HTMLElement>('.bar-top')!
  const bottomBar = shadow.querySelector<HTMLElement>('.bar-bottom')!
  const name = shadow.querySelector<HTMLElement>('.name')!
  const scope = shadow.querySelector<HTMLElement>('.scope')!
  const chip = shadow.querySelector<HTMLButtonElement>('.state')!
  const textSwatch = shadow.querySelector<HTMLButtonElement>('.swatch.text')!
  const bgSwatch = shadow.querySelector<HTMLButtonElement>('.swatch.background')!
  const textDot = textSwatch.querySelector<HTMLElement>('i')!
  const bgDot = bgSwatch.querySelector<HTMLElement>('i')!
  const stateMenu = shadow.querySelector<HTMLElement>('.state-menu')!
  const colorMenu = shadow.querySelector<HTMLElement>('.color-menu')!
  const wheel = shadow.querySelector<HTMLElement>('.wheel')!
  const thumb = shadow.querySelector<HTMLElement>('.wheel-thumb')!
  const saturation = shadow.querySelector<HTMLInputElement>('.saturation')!
  const readoutDot = shadow.querySelector<HTMLElement>('.readout i')!
  const readoutName = shadow.querySelector<HTMLElement>('.color-name')!
  const swatchList = shadow.querySelector<HTMLElement>('.swatches')!
  const swatchLabel = shadow.querySelector<HTMLElement>('.swatches-label')!
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
  // Which colour the open menu edits, and the swatch button it hangs off.
  let property = 'background-color'
  let colorButton = bgSwatch
  const closeMenus = () => {
    stateMenu.hidden = true
    colorMenu.hidden = true
    chip.setAttribute('aria-expanded', 'false')
    textSwatch.setAttribute('aria-expanded', 'false')
    bgSwatch.setAttribute('aria-expanded', 'false')
    open = undefined
  }
  const openState = () => {
    closeMenus()
    stateMenu.hidden = false
    chip.setAttribute('aria-expanded', 'true')
    open = { el: stateMenu, anchor: topBar }
    stateMenu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }
  const showColor = (hsl: Hsl, forced?: Swatch) => {
    current = hsl
    snapped = forced ?? nearestSwatch(hsl, latest().swatches)
    const hex = snapped?.value ?? toHex(hsl)
    readoutDot.style.background = hex
    readoutName.textContent = snapped ? snapped.name : hex
    saveButton.disabled = !!snapped || !saveName.value.trim()
    const at = thumbPosition(hsl)
    thumb.style.left = `${at.x * 100}%`
    thumb.style.top = `${at.y * 100}%`
    wheel.style.background = wheelBackground(hsl.s)
    for (const button of swatchList.querySelectorAll<HTMLElement>('button'))
      button.setAttribute('aria-pressed', String(button.dataset.id === snapped?.id))
  }
  // Build the project-colour dots for the current document; clicking one binds the element to it.
  const renderSwatches = () => {
    const list = latest().swatches
    swatchLabel.classList.toggle('hidden', list.length === 0)
    swatchList.replaceChildren(
      ...list.map((item) => {
        const button = doc.createElement('button')
        button.type = 'button'
        button.dataset.id = item.id
        button.title = item.name
        button.setAttribute('aria-label', item.name)
        button.style.background = item.value
        button.addEventListener('click', (event) => {
          event.stopPropagation()
          colorDirty = true
          const hsl = parseColor(item.value) ?? current
          saturation.value = String(Math.round((hsl.s || 1) * 100))
          showColor(hsl, item)
          edit('drag')
        })
        return button
      }),
    )
  }
  const openColor = (hsl: Hsl) => {
    closeMenus()
    colorMenu.hidden = false
    colorButton.setAttribute('aria-expanded', 'true')
    open = { el: colorMenu, anchor: bottomBar }
    saturation.value = String(Math.round((hsl.s || 1) * 100))
    saveName.value = ''
    colorDirty = false
    renderSwatches()
    showColor(hsl)
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

  const currentColor = () =>
    element ? view.getComputedStyle(element).getPropertyValue(property) : ''
  const edit = (phase: 'drag' | 'commit') =>
    onColor({
      property,
      value: snapped
        ? { type: 'designToken', ref: snapped.id }
        : { type: 'color', value: toHex(current) },
      phase,
    })
  // Open the wheel for a property; clicking the same swatch again commits and closes it.
  const toggleColor = (next: string, button: HTMLButtonElement) => {
    if (open?.el === colorMenu && property === next) {
      commitColor()
      closeMenus()
      return
    }
    if (open?.el === colorMenu) commitColor()
    property = next
    colorButton = button
    openColor(parseColor(currentColor()) ?? { h: 0, s: 1, l: 0.5 })
  }
  textSwatch.addEventListener('click', (event) => {
    event.stopPropagation()
    toggleColor('color', textSwatch)
  })
  bgSwatch.addEventListener('click', (event) => {
    event.stopPropagation()
    toggleColor('background-color', bgSwatch)
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
    edit('drag')
  })
  saveName.addEventListener('input', () => {
    saveButton.disabled = !!snapped || !saveName.value.trim()
  })
  saveForm.addEventListener('submit', (event) => {
    event.preventDefault()
    if (snapped || !saveName.value.trim()) return
    onColor({
      property,
      token: { name: saveName.value.trim(), value: toHex(current) },
    })
    closeMenus()
  })

  const outside = (event: Event) => {
    if (open && !event.composedPath().includes(host)) {
      commitColor()
      closeMenus()
    }
  }
  const key = (event: KeyboardEvent) => {
    if (!open || event.key !== 'Escape') return
    event.stopPropagation()
    const opener = open.el === stateMenu ? chip : colorButton
    commitColor()
    closeMenus()
    opener.focus()
  }
  doc.addEventListener('pointerdown', outside, true)
  host.addEventListener('keydown', key)

  const placeBar = (bar: HTMLElement, left: number, top: number) => {
    bar.style.left = `${Math.max(2, Math.min(left, view.innerWidth - bar.offsetWidth - 2))}px`
    bar.style.top = `${top}px`
  }
  let frame = 0
  const paint = () => {
    const selected = doc.querySelector('[data-freeflow-selected]')
    // Close only when the selection moves to a different element, not while it is briefly
    // absent between a morph clearing the marker and highlight() re-applying it.
    if (selected && selected !== element) {
      element = selected
      closeMenus()
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
        textSwatch.hidden = !selection.textColor
        const computed = view.getComputedStyle(selected!)
        const textValue = computed.getPropertyValue('color')
        const bgValue = computed.getPropertyValue('background-color')
        textDot.style.background = textValue
        textSwatch.setAttribute('aria-label', `Text color: ${textValue}`)
        bgDot.style.background = bgValue
        bgSwatch.setAttribute('aria-label', `Background color: ${bgValue}`)
      }
      for (const rect of rects) {
        rect.setAttribute('x', String(bounds.left))
        rect.setAttribute('y', String(bounds.top))
        rect.setAttribute('width', String(bounds.width))
        rect.setAttribute('height', String(bounds.height))
      }
      // Top bar above the element (below when there is no room); bottom bar below. When the bottom
      // bar cannot fit below, stack it above the top bar so it never covers the element itself.
      const topFits = bounds.top - topBar.offsetHeight - 4 >= 2
      const topTop = topFits ? bounds.top - topBar.offsetHeight - 4 : bounds.top + 4
      placeBar(topBar, bounds.left, topTop)
      const bottomFits = bounds.bottom + bottomBar.offsetHeight + 4 <= view.innerHeight - 2
      placeBar(
        bottomBar,
        bounds.left,
        bottomFits ? bounds.bottom + 4 : Math.max(2, topTop - bottomBar.offsetHeight - 4),
      )
      if (open) {
        const anchor = open.anchor.getBoundingClientRect()
        const under = anchor.bottom + 4
        const fits = under + open.el.offsetHeight <= view.innerHeight - 4
        open.el.style.left = `${Math.max(4, Math.min(anchor.left, view.innerWidth - open.el.offsetWidth - 4))}px`
        open.el.style.top = `${fits ? under : Math.max(4, anchor.top - open.el.offsetHeight - 4)}px`
      }
    }
    // When not visible the host is hidden but the menu stays open, so it returns on its own.
    frame = view.requestAnimationFrame(paint)
  }
  paint()
  return () => {
    view.cancelAnimationFrame(frame)
    doc.removeEventListener('pointerdown', outside, true)
    host.remove()
  }
}
