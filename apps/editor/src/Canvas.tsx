import { useEffect, useRef, useState } from 'react'

function highlight(frame: HTMLIFrameElement | null, selected: string) {
  for (const element of frame?.contentDocument?.querySelectorAll('[data-freeflow-node]') ?? []) {
    element.toggleAttribute(
      'data-freeflow-selected',
      element.getAttribute('data-freeflow-node') === selected,
    )
  }
}

export function Canvas({
  html,
  width,
  selected,
  select,
}: {
  html: string
  width: number
  selected: string
  select: (id: string) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const shell = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(width)
  const zoom = Math.min(1, available / width)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const selectRef = useRef(select)
  selectRef.current = select
  useEffect(() => {
    highlight(frame.current, selected)
  }, [selected])
  useEffect(() => {
    const workspace = shell.current?.parentElement
    if (!workspace) return
    const observer = new ResizeObserver(() =>
      setAvailable(Math.max(320, workspace.clientWidth - 56)),
    )
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={shell} className="canvas-shell" style={{ width: width * zoom }}>
      <iframe
        ref={frame}
        title="Site canvas"
        sandbox="allow-same-origin"
        srcDoc={html}
        style={{
          width,
          height: `${100 / zoom}%`,
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
        }}
        onLoad={() => {
          const doc = frame.current?.contentDocument
          if (!doc) return
          const style = doc.createElement('style')
          style.textContent =
            '[data-freeflow-node]:hover { outline: 1px solid #8775ed !important; outline-offset: -1px } [data-freeflow-selected] { outline: 2px solid #6d51df !important; outline-offset: -2px }'
          doc.head.append(style)
          const pick = (event: Event) => {
            event.preventDefault()
            event.stopPropagation()
            const target = event.target as Element | null
            const element = target?.closest?.('[data-freeflow-node]')
            const id = element?.getAttribute('data-freeflow-node')
            if (id) selectRef.current(id)
          }
          doc.addEventListener('click', pick, true)
          doc.addEventListener('auxclick', pick, true)
          doc.addEventListener('submit', (event) => event.preventDefault(), true)
          doc.addEventListener(
            'keydown',
            (event) => {
              if (event.key === 'Enter' || event.key === ' ') pick(event)
            },
            true,
          )
          highlight(frame.current, selectedRef.current)
        }}
      />
    </div>
  )
}
