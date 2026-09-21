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
  onEditText,
  editingText,
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
  editingText: boolean
  onEditText: (id: string, element: HTMLElement) => void
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
  const renderedHtml = useRef(html)
  // A preview request from the preceding save must not replace an active text editor.
  if (!editingText) renderedHtml.current = html
  const selectionCleanup = useRef<(() => void) | undefined>(undefined)
  const nameRef = useRef(selectedName)
  nameRef.current = selectedName
  useEffect(() => () => selectionCleanup.current?.(), [])
  const dragCleanup = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => dragCleanup.current?.(), [])
  const nodeActionRef = useRef(onNodeAction)
  const editTextRef = useRef(onEditText)
  editTextRef.current = onEditText
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
      let element = [...doc.querySelectorAll<HTMLElement>('[data-freeflow-node]')].find(
        (element) => element.dataset.freeflowNode === draft.node!.id,
      )
      if (element?.hasAttribute('data-freeflow-image-placeholder') && draft.node.attrs?.src) {
        const placeholder = element
        const image = doc.createElement('img')
        for (const attribute of placeholder.attributes) {
          if (attribute.name !== 'data-freeflow-image-placeholder')
            image.setAttribute(attribute.name, attribute.value)
        }
        placeholder.replaceWith(image)
        element = image
        undo.push(() => image.replaceWith(placeholder))
      }
      if (element && !element.hasAttribute('data-freeflow-editing')) {
        const target = element
        // Style previews must preserve child DOM, including its current selection marker.
        const markup = draft.node.text !== undefined ? target.innerHTML : undefined
        const style = target.getAttribute('style')
        undo.push(() => {
          if (target.hasAttribute('data-freeflow-editing')) return
          if (markup !== undefined) target.innerHTML = markup
          if (style === null) target.removeAttribute('style')
          else target.setAttribute('style', style)
        })
        for (const [attribute, value] of Object.entries(draft.node.attrs ?? {})) {
          const before = target.getAttribute(attribute)
          undo.push(() => {
            if (before === null) target.removeAttribute(attribute)
            else target.setAttribute(attribute, before)
          })
          target.setAttribute(attribute, value)
        }
        if (draft.node.text !== undefined) target.textContent = draft.node.text
        for (const [property, value] of Object.entries(draft.node.styles)) {
          if (value !== null) target.style.setProperty(property, value, 'important')
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
        srcDoc={renderedHtml.current}
        style={{
          width,
          height: `${100 / zoom}%`,
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
        }}
        onLoad={() => {
          const doc = frame.current?.contentDocument
          if (!doc) return
          for (const image of doc.querySelectorAll(
            'img[data-freeflow-node]:not([src]), img[data-freeflow-node][src=""]',
          )) {
            const placeholder = doc.createElement('div')
            for (const attribute of image.attributes)
              placeholder.setAttribute(attribute.name, attribute.value)
            placeholder.setAttribute('data-freeflow-image-placeholder', '')
            placeholder.setAttribute('aria-label', 'Image placeholder. Drop a photo here.')
            image.replaceWith(placeholder)
          }
          selectionCleanup.current?.()
          selectionCleanup.current = selectionOverlay(doc, () => nameRef.current)
          dragCleanup.current?.()
          for (const element of doc.querySelectorAll<HTMLElement>('[data-freeflow-node]'))
            element.draggable = true
          dragCleanup.current = bindDragSurface(doc)
          const style = doc.createElement('style')
          style.textContent =
            'div[data-freeflow-node]:empty, section[data-freeflow-node]:empty { min-height: 48px; min-width: 48px; } [data-freeflow-node]:not([data-freeflow-selected]):hover:not(:has([data-freeflow-node]:hover)) { outline: 1px solid #8775ed !important; outline-offset: -1px }'
          style.textContent += `[data-freeflow-image-placeholder] { min-height:160px !important; min-width:80px; background: #f2f0f7; border:1px dashed #b7afc9; box-sizing:border-box; position:relative; } [data-freeflow-image-placeholder]::after { content:""; display:block; width:40px; height:40px; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' fill='none' stroke='%239187aa' stroke-width='1.5'%3E%3Cpath d='M3 4h26v24H3zM3 24l9-11 7 8 4-5 6 8'/%3E%3Ccircle cx='22' cy='10' r='2'/%3E%3C/svg%3E"); }`
          style.textContent += MOTION_CSS
          style.textContent +=
            '[data-freeflow-editing] .tiptap {font:inherit;color:inherit;line-height:inherit;letter-spacing:inherit;cursor:text;user-select:text;} [data-freeflow-editing] .tiptap p {font:inherit;color:inherit;line-height:inherit;letter-spacing:inherit;margin:0;} [data-freeflow-editing] .tiptap strong {font-weight:bold;} [data-freeflow-editing] .tiptap em {font-style:italic;}'
          doc.head.append(style)
          const pick = (event: Event) => {
            if ((event.target as Element | null)?.closest?.('[data-freeflow-editing]')) return
            event.preventDefault()
            event.stopPropagation()
            const target = event.target as Element | null
            const element = target?.closest?.('[data-freeflow-node]')
            const id = element?.getAttribute('data-freeflow-node')
            if (id) selectRef.current(id)
          }
          doc.addEventListener('click', pick, true)
          doc.addEventListener('auxclick', pick, true)
          doc.addEventListener('dblclick', (event) => {
            const element = (event.target as Element | null)?.closest?.<HTMLElement>(
              '[data-freeflow-node]',
            )
            const id = element?.dataset.freeflowNode
            if (id && element && !element.hasAttribute('data-freeflow-editing')) {
              event.preventDefault()
              editTextRef.current(id, element)
            }
          })
          doc.addEventListener('submit', (event) => event.preventDefault(), true)
          doc.addEventListener(
            'keydown',
            (event) => {
              if ((event.target as Element | null)?.closest?.('[data-freeflow-editing]')) return
              const direction = historyShortcut(event)
              if (direction) {
                event.preventDefault()
                historyRef.current(direction)
                return
              }
              // A form field on the page owns its own keystrokes, the way the editor chrome does.
              if (
                (event.target as Element | null)?.closest?.(
                  'input, textarea, select, [contenteditable="true"]',
                )
              )
                return
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
