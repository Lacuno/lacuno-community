import { type CssValue, kw, num, px, type State } from '@miralo/schema'
import type { TiptapEditorHTMLElement } from '@tiptap/core'
import {
  type Hsl,
  nearestSwatch,
  parseColor,
  type StyleEdit,
  type Swatch,
  thumbPosition,
  toHex,
  WHEEL_SIZE,
  wheelBackground,
  wheelColor,
} from './colorWheel.js'
import { STATES, stateInfo } from './states.js'
import { type Snap, snapTo, tokenPx } from './tokens.js'

type Side = 'top' | 'right' | 'bottom' | 'left'

export type Selection = {
  name: string
  /** The breakpoint being edited, as shown to the designer. */
  scope: string
  state: State
  states: State[]
  /** Whether this element takes a text colour, so the text swatch is offered. */
  textColor: boolean
  swatches: Swatch[]
  /** The spacing and size tokens the handles snap to. */
  tokens: Record<'spacing' | 'size', { ref: string; name: string; value: CssValue }[]>
  /** The spacing side whose sidebar input has focus, so its boxes show without the chip. */
  spacingFocus: { kind: 'padding' | 'margin'; side: Side } | null
  /** Nodes an agent batch just changed, outlined briefly whether or not anything is selected. */
  flash: string[]
}

const svg = (icon: string) =>
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>`

// The two swatch icons: an "A" for text colour, a striped block for background colour.
const TEXT_ICON = '<path d="M3.5 13 8 3l4.5 10"/><path d="M5.5 9.5h5"/>'
const BACKGROUND_ICON =
  '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M4 10 10 4M7 13 13 7"/>'
// The spacing chip's box-model glyph: a border box around its content box.
const SPACING_ICON =
  '<rect x="2" y="2" width="12" height="12" rx="1"/><rect x="5.5" y="5.5" width="5" height="5"/>'

const SIDES = ['top', 'right', 'bottom', 'left']
// Spacing mode is the designer's choice for the editor session, not per element, so it outlives
// selection changes, morphs and the overlay itself.
let spacingMode = false

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
  onStyle: (edit: StyleEdit) => void,
): () => void {
  const view = doc.defaultView
  if (!view) return () => {}
  const host = doc.createElement('div')
  host.setAttribute('data-miralo-selection-overlay', '')
  // A unique id keeps the morph from ever matching a server node against this host.
  host.id = 'miralo-selection-overlay'
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
    .state.active, .bar .spacing[aria-pressed="true"] { background:white;color:#6434d9; }
    .swatch i { display:block;width:14px;height:14px;border-radius:50%;border:1px solid #ffffffaa;box-shadow:inset 0 0 0 1px #0002; }
    .menu { pointer-events:auto;position:absolute;box-sizing:border-box;padding:4px;border-radius:8px;background:white;color:#1f1533;box-shadow:0 6px 24px #0004;font-weight:400; }
    .menu[hidden], .menu [hidden] { display:none; }
    .state-menu { min-width:220px; }
    .state-menu button { display:flex;align-items:center;gap:10px;width:100%;padding:6px 8px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer; }
    .state-menu button:hover, .state-menu button:focus-visible { background:#f1ecfd;outline:none; }
    .state-menu button[aria-checked="true"] { background:#6434d9;color:white; }
    .state-menu button[aria-checked="true"] small { color:#ffffffcc; }
    .state-menu strong { display:block;font-weight:600; }
    .state-menu small { display:block;color:#655484;font-size:10px; }
    .color-menu { display:grid;grid-template-columns:minmax(0, 1fr);gap:8px;padding:12px;width:${WHEEL_SIZE + 24}px; }
    .color-menu > * { min-width:0; }
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
    .save { display:flex;gap:4px;min-width:0; }
    .save input { flex:1;min-width:0;padding:4px 6px;border:1px solid #d9d2ea;border-radius:4px;font:inherit;font-weight:400; }
    .save button { flex-shrink:0;padding:4px 8px;border:0;border-radius:4px;background:#6434d9;color:white;font:inherit;cursor:pointer; }
    .save button:disabled { opacity:.5;cursor:default; }
    .handle { position:absolute;pointer-events:auto;border:1px solid white;border-radius:3px;box-shadow:0 1px 3px #0006; }
    .handle.padding { background:#6434d9; }
    .handle.margin { background:#e8873b; }
    .handle.top, .handle.bottom { width:24px;height:6px;margin:-3px 0 0 -12px;cursor:ns-resize; }
    .handle.left, .handle.right { width:6px;height:24px;margin:-12px 0 0 -3px;cursor:ew-resize; }
    .handle.size { width:7px;height:7px;margin:-5px 0 0 -5px;border:1.5px solid #6434d9;border-radius:1px;background:white; }
    .handle.corner { cursor:nwse-resize; }
    .handles:not(.spacing-mode) .handle:not(.size), .handles:not(.strips) .strip { display:none; }
    .strip { position:absolute;display:flex;align-items:center;justify-content:center;pointer-events:none;background:#6434d926;color:#6434d9; }
    .strip.margin { background:#e8873b26;color:#e8873b; }
    .strip.padding.focus { background:#6434d94d; }
    .strip.margin.focus { background:#e8873b4d; }
    .strip span { font-size:11px;line-height:14px;text-shadow:0 0 2px white,0 0 2px white; }
    .strip.top span, .strip.bottom span { translate:28px 0; }
    .strip.left span, .strip.right span { translate:0 -22px; }
    .strip.thin span { position:absolute; }
    .strip.thin.top span { bottom:100%; }
    .strip.thin.bottom span { top:100%; }
    .strip.thin.left span { right:100%;padding-right:2px; }
    .strip.thin.right span { left:100%;padding-left:2px; }
    .tag { position:absolute;padding:2px 6px;border-radius:4px;background:#1f1533;color:white;box-shadow:0 2px 8px #0004;pointer-events:none;white-space:nowrap; }
    :host([data-idle]) > :not(.flash) { display:none !important; }
    .flash > div { position:absolute;box-sizing:border-box;border:2px solid #12a150;border-radius:2px;animation:flash-fade 1s ease-in forwards; }
    @keyframes flash-fade { from { opacity:1; } to { opacity:0; } }
    @keyframes selection-march { to { stroke-dashoffset:-10; } }
    @media(prefers-reduced-motion:reduce) { .selection-dashes { animation:none; } }
  </style><svg class="frame"><rect class="selection-base"/><rect class="selection-dashes"/></svg>
  <div class="bar bar-top selection-label"><span class="name"></span><span class="scope"></span><button class="state" type="button" aria-haspopup="menu" aria-expanded="false"></button><button class="spacing" type="button" aria-pressed="${spacingMode}">${svg(SPACING_ICON)}Spacing</button></div>
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
    <div class="wheel"><div class="wheel-thumb"></div></div>
    <label>Saturation<input class="saturation" type="range" min="0" max="100" aria-label="Saturation"></label>
    <div class="readout"><i></i><span class="color-name"></span></div>
    <label class="swatches-label">Project colors</label>
    <div class="swatches" role="listbox" aria-label="Project colors"></div>
    <div class="save"><input type="text" placeholder="Save as project color…" aria-label="Project color name" maxlength="40"><button type="button" disabled>Save</button></div>
  </div>
  <div class="handles" hidden>${SIDES.flatMap((side) =>
    ['padding', 'margin'].map(
      (kind) =>
        `<div class="strip ${kind} ${side}" data-side="${side}" data-kind="${kind}"><span></span></div>`,
    ),
  ).join('')}${SIDES.flatMap((side) => ['padding', 'margin'].map((kind) => ({ side, kind })))
    .concat(['right', 'bottom', 'corner'].map((side) => ({ side, kind: 'size' })))
    .map(
      ({ side, kind }) =>
        `<div class="handle ${kind} ${side}" data-side="${side}" data-kind="${kind}"></div>`,
    )
    .join('')}</div>
  <div class="tag" hidden></div><div class="flash"></div>`
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
  const saveRow = shadow.querySelector<HTMLElement>('.save')!
  const saveName = saveRow.querySelector<HTMLInputElement>('input')!
  const saveButton = saveRow.querySelector<HTMLButtonElement>('button')!
  const handlesLayer = shadow.querySelector<HTMLElement>('.handles')!
  const handles = shadow.querySelectorAll<HTMLElement>('.handle')
  const strips = shadow.querySelectorAll<HTMLElement>('.strip')
  const spacingChip = shadow.querySelector<HTMLButtonElement>('.spacing')!
  const tag = shadow.querySelector<HTMLElement>('.tag')!
  const flashLayer = shadow.querySelector<HTMLElement>('.flash')!

  // Which menu is open, and the anchor bar it hangs off.
  let open: { el: HTMLElement; anchor: HTMLElement } | undefined
  let shown = ''
  // Start from the current selection so the first paint is not mistaken for a selection change.
  let element: Element | null = doc.querySelector('[data-miralo-selected]')
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
    swatchLabel.hidden = list.length === 0
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
          const hsl = parseColor(item.value) ?? current
          saturation.value = String(Math.round((hsl.s || 1) * 100))
          showColor(hsl, item)
          // The drag previews through the panel's draft, so the draft agrees with the commit.
          edit('drag')
          edit('commit')
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
    renderSwatches()
    showColor(hsl)
  }

  chip.addEventListener('click', (event) => {
    event.stopPropagation()
    if (open?.el === stateMenu) closeMenus()
    else openState()
  })
  spacingChip.addEventListener('click', (event) => {
    event.stopPropagation()
    spacingMode = !spacingMode
    spacingChip.setAttribute('aria-pressed', String(spacingMode))
  })
  // Holding Alt over the selected element shows its spacing boxes. The pointer reports Alt, so a
  // key released outside the canvas never leaves it stuck.
  let altHeld = false
  const alt = (event: PointerEvent) => {
    altHeld = event.altKey
  }
  doc.addEventListener('pointermove', alt)
  stateMenu.addEventListener('click', (event) => {
    const item = (event.target as Element).closest<HTMLElement>('[data-state]')
    if (!item) return
    event.stopPropagation()
    closeMenus()
    setState(item.dataset.state as State)
  })

  // Words selected in the text being edited start the text wheel from their own colour. The
  // editor's selection, not the page's: it survives formatting from the toolbar.
  const currentColor = () => {
    const text = element?.querySelector<TiptapEditorHTMLElement>('.tiptap')?.editor?.view
    const from =
      property === 'color' && text && !text.state.selection.empty
        ? text.domAtPos(text.state.selection.from + 1).node.parentElement
        : element
    return from ? view.getComputedStyle(from).getPropertyValue(property) : ''
  }
  const edit = (phase: 'drag' | 'commit') =>
    onStyle({
      property,
      value: snapped
        ? { type: 'designToken', ref: snapped.id }
        : { type: 'color', value: toHex(current) },
      phase,
    })
  // Open the wheel for a property; clicking the same swatch again closes it.
  const toggleColor = (next: string, button: HTMLButtonElement) => {
    if (open?.el === colorMenu && property === next) {
      closeMenus()
      return
    }
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

  // Each gesture (a wheel drag, a saturation slide, a swatch click) commits once as it ends.
  let dragging = false
  const track = (event: { clientX: number; clientY: number }) => {
    showColor(wheelColor(wheel, event.clientX, event.clientY, Number(saturation.value) / 100))
    edit('drag')
  }
  const release = () => {
    if (!dragging) return
    dragging = false
    doc.removeEventListener('pointerup', release)
    doc.removeEventListener('mouseup', release)
    edit('commit')
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
    showColor({ ...current, s: Number(saturation.value) / 100 })
    edit('drag')
  })
  saturation.addEventListener('change', () => edit('commit'))
  saveName.addEventListener('input', () => {
    saveButton.disabled = !!snapped || !saveName.value.trim()
  })
  // The sandboxed canvas never submits a form, so the button and Enter save directly.
  const saveColor = () => {
    if (snapped || !saveName.value.trim()) return
    onStyle({
      property,
      token: { name: saveName.value.trim(), value: toHex(current) },
    })
    closeMenus()
  }
  saveButton.addEventListener('click', saveColor)
  saveName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveColor()
  })

  // Handles: drag an edge to set padding (inside) or margin (outside), or the border box's right,
  // bottom or corner to set width and height. Spacing is symmetric by default (the opposite side
  // moves by the same delta) and Alt moves only the dragged side; Shift keeps the corner's ratio.
  // A value within 4px of a spacing or size token snaps to it; Ctrl or Cmd turns snapping off.
  const OPPOSITE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const
  type Axis = 'x' | 'y'
  // Each target writes max(min, from + sign × the pointer delta on its axis), plus `also`: what
  // would hold a size back. `max` is its computed max cap in px (NaN when there is none or it is
  // not in px, like an image's 100%), and `snap` the tokens it may snap to.
  type Target = {
    property: string
    axis: Axis
    sign: number
    from: number
    min: number
    max: number
    also: Record<string, CssValue>
    snap: Snap[]
  }
  const cssPx = (el: Element, property: string) =>
    Number.parseFloat(view.getComputedStyle(el).getPropertyValue(property)) || 0
  let handleDrag:
    | {
        kind: string
        start: { x: number; y: number }
        delta: { x: number; y: number }
        targets: Target[]
        /** The corner's height/width, kept while Shift is held; 0 on an edge. */
        ratio: number
        /** Ctrl or Cmd is held, so nothing snaps. */
        free: boolean
      }
    | undefined
  const targetValue = (target: Target) => {
    const value = Math.max(
      target.min,
      Math.round(target.from + target.sign * handleDrag!.delta[target.axis]),
    )
    const snap = handleDrag!.free ? undefined : snapTo(value, target.snap)
    return { value: snap?.px ?? value, snap }
  }
  const emitHandle = (phase: 'drag' | 'commit') => {
    if (!handleDrag) return
    const changes: Record<string, CssValue> = {}
    for (const target of handleDrag.targets) {
      const { value, snap } = targetValue(target)
      changes[target.property] = snap ? { type: 'designToken', ref: snap.ref } : px(value)
      // Past its max cap the drag clears the cap, and keeps it cleared for the rest of the drag so
      // the preview's draft and the commit agree.
      if (value > target.max) target.also[`max-${target.property}`] = kw('none')
      Object.assign(changes, target.also)
    }
    onStyle({ changes, phase })
  }
  const releaseHandle = () => {
    if (!handleDrag) return
    // The tag shows from the first drag frame. Commit after any, even one back at the start: the
    // frames went into the panel's draft.
    if (!tag.hidden) emitHandle('commit')
    handleDrag = undefined
    tag.hidden = true
    doc.removeEventListener('pointerup', releaseHandle)
    doc.removeEventListener('mouseup', releaseHandle)
  }
  handlesLayer.addEventListener('pointerdown', (event) => {
    const handle = (event.target as Element).closest<HTMLElement>('.handle')
    if (!handle || !element) return
    event.stopPropagation()
    event.preventDefault()
    const el = element
    const side = handle.dataset.side!
    const kind = handle.dataset.kind!
    const box = el.getBoundingClientRect()
    // A size starts from the rendered border box, less padding and border under content-box, so
    // the rendered box follows the pointer 1:1 under either box model (and when width is auto).
    const style = view.getComputedStyle(el)
    const contentBox = style.boxSizing !== 'border-box'
    // Token values in px, with rem and em resolved against the root and this element.
    const rootSize = Number.parseFloat(view.getComputedStyle(doc.documentElement).fontSize)
    const snaps = (group: 'spacing' | 'size') =>
      latest().tokens[group].flatMap(({ ref, name, value }) => {
        const pixels = tokenPx(value, Number.parseFloat(style.fontSize), rootSize)
        return pixels === undefined ? [] : [{ ref, name, px: pixels }]
      })
    // A flex parent shrinks the element along its main axis, so a drag on that axis stops it.
    const parent = el.parentElement && view.getComputedStyle(el.parentElement)
    const mainAxis =
      parent && /^(inline-)?flex$/.test(parent.display)
        ? parent.flexDirection.startsWith('row')
          ? 'x'
          : 'y'
        : undefined
    const size = (property: string, axis: Axis, total: number, a: string, b: string): Target => ({
      property,
      axis,
      sign: 1,
      min: 1,
      max: Number(style.getPropertyValue(`max-${property}`).replace(/px$/, '')),
      also: axis === mainAxis && style.flexShrink !== '0' ? { 'flex-shrink': num(0) } : {},
      snap: snaps('size'),
      from: contentBox
        ? total -
          [`padding-${a}`, `padding-${b}`, `border-${a}-width`, `border-${b}-width`]
            .map((p) => cssPx(el, p))
            .reduce((sum, n) => sum + n)
        : total,
    })
    const axis: Axis = side === 'left' || side === 'right' ? 'x' : 'y'
    const targets =
      kind === 'size'
        ? [
            ...(side === 'bottom' ? [] : [size('width', 'x', box.width, 'left', 'right')]),
            ...(side === 'right' ? [] : [size('height', 'y', box.height, 'top', 'bottom')]),
          ]
        : (event.altKey ? [side] : [side, OPPOSITE[side as Side]]).map((s) => ({
            property: `${kind}-${s}`,
            axis,
            sign: side === 'top' || side === 'left' ? -1 : 1,
            from: cssPx(el, `${kind}-${s}`),
            min: kind === 'padding' ? 0 : -Infinity,
            max: Number.NaN,
            also: {},
            snap: snaps('spacing'),
          }))
    handleDrag = {
      kind,
      start: { x: event.clientX, y: event.clientY },
      delta: { x: 0, y: 0 },
      targets,
      ratio: side === 'corner' ? box.height / box.width : 0,
      free: event.ctrlKey || event.metaKey,
    }
    handlesLayer.setPointerCapture(event.pointerId)
    doc.addEventListener('pointerup', releaseHandle)
    doc.addEventListener('mouseup', releaseHandle)
  })
  handlesLayer.addEventListener('pointermove', (event) => {
    if (!handleDrag) return
    // Iframe pointer coordinates are already in CSS px, so the drag tracks the pointer at any zoom.
    let x = event.clientX - handleDrag.start.x
    let y = event.clientY - handleDrag.start.y
    // With Shift the axis with the larger relative change leads and the other follows the ratio.
    const ratio = handleDrag.ratio
    if (ratio && event.shiftKey) {
      if (Math.abs(x) * ratio > Math.abs(y)) y = x * ratio
      else x = y / ratio
    }
    handleDrag.delta = { x, y }
    handleDrag.free = event.ctrlKey || event.metaKey
    emitHandle('drag')
    // Spacing shows the dragged side; size shows width, height, or both for the corner. A snapped
    // value shows its token's name.
    const shown = handleDrag.kind === 'size' ? handleDrag.targets : handleDrag.targets.slice(0, 1)
    tag.textContent = shown
      .map((target) => {
        const { value, snap } = targetValue(target)
        return snap ? snap.name : `${value}px`
      })
      .join(' × ')
    tag.hidden = false
    tag.style.left = `${Math.min(event.clientX + 12, view.innerWidth - tag.offsetWidth - 2)}px`
    tag.style.top = `${Math.max(2, event.clientY - 24)}px`
  })

  const outside = (event: Event) => {
    if (open && !event.composedPath().includes(host)) closeMenus()
  }
  const key = (event: KeyboardEvent) => {
    if (!open || event.key !== 'Escape') return
    event.stopPropagation()
    const opener = open.el === stateMenu ? chip : colorButton
    closeMenus()
    opener.focus()
  }
  doc.addEventListener('pointerdown', outside, true)
  host.addEventListener('keydown', key)

  const placeBar = (bar: HTMLElement, left: number, top: number) => {
    bar.style.left = `${Math.max(2, Math.min(left, view.innerWidth - bar.offsetWidth - 2))}px`
    bar.style.top = `${top}px`
  }
  // A padding handle sits just inside its edge, a margin handle just outside, a size handle on it;
  // the drawn point is clamped into view (the drag math uses the real pointer delta, not this).
  const placeHandle = (handle: HTMLElement, bounds: DOMRect) => {
    const { side, kind } = handle.dataset
    const off = kind === 'padding' ? 7 : kind === 'margin' ? -11 : 0
    const x =
      side === 'left'
        ? bounds.left + off
        : side === 'right' || side === 'corner'
          ? bounds.right - off
          : bounds.left + bounds.width / 2
    const y =
      side === 'top'
        ? bounds.top + off
        : side === 'bottom' || side === 'corner'
          ? bounds.bottom - off
          : bounds.top + bounds.height / 2
    handle.style.left = `${Math.max(2, Math.min(x, view.innerWidth - 2))}px`
    handle.style.top = `${Math.max(2, Math.min(y, view.innerHeight - 2))}px`
  }
  // Padding and margin boxes, devtools style: the padding strips between the padding box and the
  // content box, the margin strips between the margin box and the border box (inside it when
  // negative), each labelled with its px value; the dragged side's label gives way to the readout.
  const placeStrips = (
    bounds: DOMRect,
    style: CSSStyleDeclaration,
    focus: Selection['spacingFocus'],
  ) => {
    const value = (property: string) => Number.parseFloat(style.getPropertyValue(property)) || 0
    const inset = (box: Record<Side, number>, by: (side: Side) => number) => ({
      top: box.top + by('top'),
      right: box.right - by('right'),
      bottom: box.bottom - by('bottom'),
      left: box.left + by('left'),
    })
    const border = inset(bounds, (side) => value(`border-${side}-width`))
    const boxes = {
      padding: [border, inset(border, (side) => value(`padding-${side}`))],
      margin: [inset(bounds, (side) => -value(`margin-${side}`)), bounds],
    } as const
    const dragged = handleDrag?.kind !== 'size' && handleDrag?.targets[0]?.property
    for (const strip of strips) {
      const side = strip.dataset.side as Side
      const kind = strip.dataset.kind as 'padding' | 'margin'
      const [outer, inner] = boxes[kind]
      const x =
        side === 'left'
          ? [outer.left, inner.left]
          : side === 'right'
            ? [inner.right, outer.right]
            : [outer.left, outer.right]
      const y =
        side === 'top'
          ? [outer.top, inner.top]
          : side === 'bottom'
            ? [inner.bottom, outer.bottom]
            : [inner.top, inner.bottom]
      const width = Math.abs(x[1]! - x[0]!)
      const height = Math.abs(y[1]! - y[0]!)
      strip.style.left = `${Math.min(x[0]!, x[1]!)}px`
      strip.style.top = `${Math.min(y[0]!, y[1]!)}px`
      strip.style.width = `${width}px`
      strip.style.height = `${height}px`
      strip.classList.toggle('thin', (side === 'top' || side === 'bottom' ? height : width) < 14)
      strip.classList.toggle('focus', focus?.kind === kind && focus.side === side)
      const px = Math.round(value(`${kind}-${side}`))
      strip.firstElementChild!.textContent = px && dragged !== `${kind}-${side}` ? String(px) : ''
    }
  }
  let frame = 0
  let flashing = ''
  const paintFlash = (ids: string[]) => {
    if (ids.join() !== flashing) {
      flashing = ids.join()
      flashLayer.replaceChildren(...ids.map(() => doc.createElement('div')))
    }
    ids.forEach((id, index) => {
      const outline = flashLayer.children[index] as HTMLElement
      const bounds = doc
        .querySelector(`[data-miralo-node="${CSS.escape(id)}"]`)
        ?.getBoundingClientRect()
      outline.hidden = !bounds
      if (bounds)
        outline.style.cssText = `left:${bounds.left}px;top:${bounds.top}px;width:${bounds.width}px;height:${bounds.height}px`
    })
  }
  const paint = () => {
    const selected = doc.querySelector('[data-miralo-selected]')
    // Close only when the selection moves to a different element, not while it is briefly
    // absent between a morph clearing the marker and highlight() re-applying it.
    if (selected && selected !== element) {
      element = selected
      closeMenus()
    }
    const bounds = selected?.getBoundingClientRect()
    const visible =
      !doc.querySelector('[data-miralo-sort-gap]') &&
      bounds &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.bottom > 0 &&
      bounds.right > 0 &&
      bounds.top < view.innerHeight &&
      bounds.left < view.innerWidth
    const selection = latest()
    paintFlash(selection.flash)
    host.style.display = visible || flashing ? 'block' : 'none'
    host.toggleAttribute('data-idle', !visible)
    if (visible) {
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
      // Handles ride the edges every frame, but not while the element's text is being edited.
      // Spacing nubs show in spacing mode; the boxes also while a sidebar spacing input has focus
      // or Alt is held over the element.
      const editing = !!doc.querySelector('[data-miralo-editing]')
      handlesLayer.hidden = editing
      spacingChip.hidden = editing
      if (!editing) {
        const showStrips =
          spacingMode || !!selection.spacingFocus || (altHeld && selected!.matches(':hover'))
        handlesLayer.classList.toggle('spacing-mode', spacingMode)
        handlesLayer.classList.toggle('strips', showStrips)
        for (const handle of handles) placeHandle(handle, bounds)
        if (showStrips)
          placeStrips(bounds, view.getComputedStyle(selected!), selection.spacingFocus)
      }
    }
    // When not visible the host is hidden but the menu stays open, so it returns on its own.
    frame = view.requestAnimationFrame(paint)
  }
  paint()
  return () => {
    view.cancelAnimationFrame(frame)
    doc.removeEventListener('pointerdown', outside, true)
    doc.removeEventListener('pointermove', alt)
    host.remove()
  }
}
