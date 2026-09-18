import { useEffect, useRef, useState } from 'react'
import { formattingGroups } from './formatting.js'
import { historyShortcut } from './history.js'
import type { LivePreview } from './livePreview.js'

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
  onHistory,
  onComputed,
  livePreview,
}: {
  livePreview: LivePreview
  html: string
  width: number
  selected: string
  select: (id: string) => void
  onHistory: (direction: 'undo' | 'redo') => void
  onComputed: (value: { id: string; values: Record<string, string> }) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const liveRef = useRef(livePreview)
  liveRef.current = livePreview
  const restore = useRef<(() => void) | undefined>(undefined)
  const paint = () => {
    restore.current?.()
    const doc = frame.current?.contentDocument
    if (!doc) return
    const undo: (() => void)[] = []
    const draft = liveRef.current
    if (draft.node) {
      const element = [...doc.querySelectorAll<HTMLElement>('[data-freeflow-node]')].find(
        (element) => element.dataset.freeflowNode === draft.node!.id,
      )
      if (element) {
        const markup = element.innerHTML
        const style = element.getAttribute('style')
        undo.push(() => {
          element.innerHTML = markup
          if (style === null) element.removeAttribute('style')
          else element.setAttribute('style', style)
        })
        if (draft.node.text !== undefined) element.textContent = draft.node.text
        for (const [property, value] of Object.entries(draft.node.styles)) {
          if (value !== null) element.style.setProperty(property, value, 'important')
          else if (draft.node.selector) {
            for (const sheet of doc.styleSheets) {
              // Generated base rules are top-level; responsive overrides remain intact.
              let rules: CSSRuleList
              try {
                rules = sheet.cssRules
              } catch {
                continue
              }
              for (const rule of rules) {
                if (!('selectorText' in rule) || rule.selectorText !== draft.node.selector) continue
                const declaration = (rule as CSSStyleRule).style
                const before = declaration.getPropertyValue(property)
                const priority = declaration.getPropertyPriority(property)
                declaration.removeProperty(property)
                undo.push(() => {
                  if (before) declaration.setProperty(property, before, priority)
                })
              }
            }
          }
        }
      }
    }
    for (const [name, value] of Object.entries(draft.colors ?? {})) {
      const before = doc.documentElement.style.getPropertyValue(name)
      undo.push(() => {
        if (before) doc.documentElement.style.setProperty(name, before)
        else doc.documentElement.style.removeProperty(name)
      })
      doc.documentElement.style.setProperty(name, value)
    }
    restore.current = () => {
      for (const action of undo) action()
    }
  }
  const paintRef = useRef(paint)
  paintRef.current = paint
  // biome-ignore lint/correctness/useExhaustiveDependencies: paint the latest draft into the iframe when the draft changes.
  useEffect(() => {
    paintRef.current()
  }, [livePreview])

  const shell = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(width)
  const zoom = Math.min(1, available / width)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const selectRef = useRef(select)
  selectRef.current = select
  const historyRef = useRef(onHistory)
  historyRef.current = onHistory
  const computedRef = useRef(onComputed)
  computedRef.current = onComputed
  const reportStyles = () => {
    const doc = frame.current?.contentDocument
    const element = [...(doc?.querySelectorAll('[data-freeflow-node]') ?? [])].find(
      (element) => element.getAttribute('data-freeflow-node') === selectedRef.current,
    )
    const styles = element && doc?.defaultView?.getComputedStyle(element)
    computedRef.current({
      id: selectedRef.current,
      values: styles
        ? Object.fromEntries(
            formattingGroups.flatMap((group) =>
              group.fields.map((field) => [
                field.property,
                styles.getPropertyValue(field.property),
              ]),
            ),
          )
        : {},
    })
  }
  const reportRef = useRef(reportStyles)
  reportRef.current = reportStyles
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing the iframe width changes its computed responsive styles.
  useEffect(() => {
    highlight(frame.current, selected)
    reportRef.current()
  }, [selected, width])
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
            'div[data-freeflow-selected]:empty, section[data-freeflow-selected]:empty { min-height: 48px; min-width: 48px; } [data-freeflow-node]:hover { outline: 1px solid #8775ed !important; outline-offset: -1px } [data-freeflow-selected] { outline: 2px solid #6d51df !important; outline-offset: -2px }'
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
              const direction = historyShortcut(event)
              if (direction) {
                event.preventDefault()
                historyRef.current(direction)
                return
              }
              if (event.key === 'Enter' || event.key === ' ') pick(event)
            },
            true,
          )
          highlight(frame.current, selectedRef.current)
          restore.current = undefined
          paintRef.current()
          reportRef.current()
        }}
      />
    </div>
  )
}
