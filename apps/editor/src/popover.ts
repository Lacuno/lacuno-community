/** Keep a popover beside its trigger, inside the viewport, flipping above when it would not fit. */
export function placePopover(anchor: Element | null | undefined, panel: HTMLElement | null) {
  if (!anchor || !panel) return
  // A trigger's click opens its popover only after the handler, so measure it a frame later.
  requestAnimationFrame(() => {
    const rect = anchor.getBoundingClientRect()
    const below = rect.bottom + 8
    const fits = below + panel.offsetHeight <= innerHeight - 12
    panel.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - panel.offsetWidth - 12))}px`
    panel.style.top = `${Math.max(12, fits ? below : rect.top - panel.offsetHeight - 8)}px`
  })
}
