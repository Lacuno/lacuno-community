import { MOTION_CSS } from '@freeflow/css'
import { useEffect, useRef, useState } from 'react'
import { formattingGroups } from './formatting.js'
import { historyShortcut } from './history.js'
import type { LivePreview } from './livePreview.js'
import { selectionOverlay } from './selectionOverlay.js'

function highlight(frame: HTMLIFrameElement | null, selected: string) {
  for (const element of frame?.contentDocument?.querySelectorAll('[data-freeflow-node]') ?? []) {
    element.toggleAttribute(
      'data-freeflow-selected',
      element.getAttribute('data-freeflow-node') === selected,
    )
  }
}

export function Canvas({
  onNodeAction,
  bindDragSurface,
  html,
  width,
  selected,
  selectedName,
  select,
  onHistory,
  onComputed,
  livePreview,
}: {
  onNodeAction: (action: 'duplicate' | 'delete', id: string) => void
  bindDragSurface: (surface: Document) => () => void
  livePreview: LivePreview
  html: string
  width: number
  selected: string
  selectedName: string
  select: (id: string) => void
  onHistory: (direction: 'undo' | 'redo') => void
  onComputed: (value: { id: string; values: Record<string, string> }) => void
}) {
  const selectionCleanup = useRef<(() => void) | undefined>(undefined)
  const nameRef = useRef(selectedName)
  nameRef.current = selectedName
  useEffect(() => () => selectionCleanup.current?.(), [])
  const dragCleanup = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => dragCleanup.current?.(), [])
  const nodeActionRef = useRef(onNodeAction)
  nodeActionRef.current = onNodeAction
  const frame = useRef<HTMLIFrameElement>(null)
  const scrollPosition = useRef({ x: 0, y: 0 })
  const liveRef = useRef(livePreview)
  liveRef.current = livePreview
  const motionReplay = useRef<(() => void) | undefined>(undefined)
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
        // Style previews must preserve child DOM, including its current selection marker.
        const markup = draft.node.text !== undefined ? element.innerHTML : undefined
        const style = element.getAttribute('style')
        undo.push(() => {
          if (markup !== undefined) element.innerHTML = markup
          if (style === null) element.removeAttribute('style')
          else element.setAttribute('style', style)
        })
        if (draft.node.text !== undefined) element.textContent = draft.node.text
        for (const [property, value] of Object.entries(draft.node.styles)) {
          if (value !== null) element.style.setProperty(property, value, 'important')
          else if (draft.node.selector) {
            for (const sheet of doc.styleSheets) {
              let rules: CSSRuleList
              try {
                rules = sheet.cssRules
              } catch {
                continue
              }
              const clearRules = (items: CSSRuleList, media?: string) => {
                for (const rule of items) {
                  if ('conditionText' in rule && 'cssRules' in rule) {
                    clearRules(
                      (rule as CSSMediaRule).cssRules,
                      (rule as CSSMediaRule).conditionText,
                    )
                    continue
                  }
                  if (
                    media !== draft.node?.media ||
                    !('selectorText' in rule) ||
                    rule.selectorText !== draft.node?.selector
                  )
                    continue
                  const declaration = (rule as CSSStyleRule).style
                  const before = declaration.getPropertyValue(property)
                  const priority = declaration.getPropertyPriority(property)
                  declaration.removeProperty(property)
                  undo.push(() => {
                    if (before) declaration.setProperty(property, before, priority)
                  })
                }
              }
              clearRules(rules)
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
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let cleanup: (() => void) | undefined
    const preview = (event: Event) => {
      const { id, kind } = (event as CustomEvent<{ id: string; kind: string }>).detail
      if (id !== selectedRef.current) return
      cleanup?.()
      clearTimeout(timer)
      motionReplay.current = () => preview(event)
      const doc = frame.current?.contentDocument
      const element = [...(doc?.querySelectorAll<HTMLElement>('[data-freeflow-node]') ?? [])].find(
        (item) => item.dataset.freeflowNode === id,
      )
      if (!doc || !element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      element.setAttribute('data-freeflow-motion', '')
      const before = element.getAttribute('style')
      cleanup = () => {
        element.removeAttribute('data-ff-enter')
        if (before === null) element.removeAttribute('style')
        else element.setAttribute('style', before)
        paintRef.current()
      }
      const computed = doc.defaultView!.getComputedStyle(element)
      const duration = Number.parseFloat(computed.getPropertyValue('--ff-duration')) || 400
      const delay = Number.parseFloat(computed.getPropertyValue('--ff-delay')) || 0
      if (kind === 'entrance') {
        for (const property of ['opacity', 'translate']) {
          const value = element.style.getPropertyValue(property)
          if (value) element.style.setProperty(property, value)
        }
        element.removeAttribute('data-ff-enter')
        void element.offsetWidth
        element.setAttribute('data-ff-enter', '')
      } else {
        for (const property of ['opacity', 'scale', 'rotate', 'box-shadow']) {
          const value = computed.getPropertyValue(`--ff-hover-${property}`).trim()
          if (value) element.style.setProperty(property, value, 'important')
        }
      }
      timer = setTimeout(
        () => {
          cleanup?.()
          cleanup = undefined
          motionReplay.current = undefined
        },
        duration + delay + 500,
      )
    }
    window.addEventListener('freeflow:motion-preview', preview)
    return () => {
      window.removeEventListener('freeflow:motion-preview', preview)
      clearTimeout(timer)
      cleanup?.()
    }
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
          selectionCleanup.current?.()
          selectionCleanup.current = selectionOverlay(doc, () => nameRef.current)
          dragCleanup.current?.()
          for (const element of doc.querySelectorAll<HTMLElement>('[data-freeflow-node]'))
            element.draggable = true
          dragCleanup.current = bindDragSurface(doc)
          const style = doc.createElement('style')
          style.textContent =
            'div[data-freeflow-node]:empty, section[data-freeflow-node]:empty { min-height: 48px; min-width: 48px; } [data-freeflow-node]:not([data-freeflow-selected]):hover:not(:has([data-freeflow-node]:hover)) { outline: 1px solid #8775ed !important; outline-offset: -1px }'
          style.textContent += MOTION_CSS
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
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
                event.preventDefault()
                nodeActionRef.current('duplicate', selectedRef.current)
                return
              }
              if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault()
                nodeActionRef.current('delete', selectedRef.current)
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
          motionReplay.current?.()
          const view = doc.defaultView
          if (view) {
            view.scrollTo({
              left: scrollPosition.current.x,
              top: scrollPosition.current.y,
              behavior: 'instant',
            })
            view.addEventListener(
              'scroll',
              () => {
                // Ignore events from the document being replaced by an autosave refresh.
                if (frame.current?.contentDocument === doc)
                  scrollPosition.current = { x: view.scrollX, y: view.scrollY }
              },
              { passive: true },
            )
          }
        }}
      />
    </div>
  )
}
