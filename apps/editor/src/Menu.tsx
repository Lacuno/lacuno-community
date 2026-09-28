import { useLayoutEffect, useRef } from 'react'

export type MenuItem = { label: string; run: () => void; disabled?: boolean; danger?: boolean }
export type MenuPoint = { x: number; y: number }

/** Where a menu opens: at the pointer for a right click, else below the element that asked. */
export function menuPoint(event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) {
  if (event.type === 'contextmenu' && 'clientX' in event && (event.clientX || event.clientY))
    return { x: event.clientX, y: event.clientY }
  const rect = event.currentTarget.getBoundingClientRect()
  return { x: rect.left, y: rect.bottom + 4 }
}

/**
 * A menu of actions at a point, above everything else. Like a native context menu it stays open
 * until an item is chosen, Escape or a press elsewhere, not when the button that opened it is
 * released, and it hands the focus back to where it was.
 */
export function Menu({
  at,
  label,
  items,
  close,
}: {
  at: MenuPoint
  label: string
  items: MenuItem[]
  close: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)
  const latest = useRef(close)
  latest.current = close
  // biome-ignore lint/correctness/useExhaustiveDependencies: a menu opens once; a new point is a new menu.
  useLayoutEffect(() => {
    const element = menu.current!
    const opener = document.activeElement as HTMLElement | null
    element.showPopover()
    const { offsetWidth: width, offsetHeight: height } = element
    element.style.left = `${Math.max(8, Math.min(at.x, innerWidth - width - 8))}px`
    element.style.top = `${Math.max(8, at.y + height > innerHeight - 8 ? at.y - height : at.y)}px`
    element.querySelector<HTMLElement>('[role="menuitem"]:enabled')?.focus()
    // The trigger of an open menu closes it with its own click.
    const outside = (event: Event) => {
      const target = event.target as Element
      if (
        !element.contains(target) &&
        !target.closest?.('[aria-haspopup="menu"][aria-expanded="true"]')
      )
        latest.current()
    }
    const leave = () => latest.current()
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('blur', leave)
    window.addEventListener('resize', leave)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('blur', leave)
      window.removeEventListener('resize', leave)
      if (element.contains(document.activeElement) || document.activeElement === document.body)
        opener?.focus()
    }
  }, [])
  return (
    <div
      ref={menu}
      popover="manual"
      role="menu"
      aria-label={label}
      className="menu"
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onKeyDown={(event) => {
        const enabled = [
          ...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:enabled'),
        ]
        const index = enabled.indexOf(document.activeElement as HTMLElement)
        const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: -1 }[event.key]
        if (move !== undefined) {
          event.preventDefault()
          enabled.at(move % enabled.length)?.focus()
        } else if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
      }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          data-danger={item.danger || undefined}
          disabled={item.disabled}
          onClick={() => {
            close()
            item.run()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
