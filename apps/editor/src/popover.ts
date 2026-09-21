/** Keep a popover beside its trigger, inside the viewport, flipping above when it would not fit. */
export function placePopover(anchor: Element | null | undefined, panel: HTMLElement | null) {
  if (!anchor || !panel) return
  const rect = anchor.getBoundingClientRect()
  // A popover is still hidden while its trigger is clicked, so fall back to its stylesheet size.
  const style = getComputedStyle(panel)
  const width = panel.offsetWidth || Number.parseFloat(style.width) || 290
  const height = panel.offsetHeight || Number.parseFloat(style.height) || 200
  const below = rect.bottom + 8
  panel.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`
  panel.style.top = `${Math.max(12, below + height <= innerHeight - 12 ? below : rect.top - height - 8)}px`
}
