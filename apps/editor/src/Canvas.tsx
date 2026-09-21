import { MOTION_CSS } from '@freeflow/css'
import type { State } from '@freeflow/schema'
import { useEffect, useRef, useState } from 'react'
import { formattingGroups } from './formatting.js'
import { historyShortcut } from './history.js'
import { selectionOverlay } from './selectionOverlay.js'

/** The unsaved edit a panel paints into the canvas before it is committed. */
export type LivePreview = {
  node?: {
    id: string
    text?: string
    attrs?: Record<string, string>
    selector?: string
    media?: string
    state?: string
    styles: Record<string, string | null>
  }
  colors?: Record<string, string>
}

function nodeElement(doc: Document | null | undefined, id: string) {
  return doc?.querySelector<HTMLElement>(`[data-freeflow-node="${CSS.escape(id)}"]`) ?? undefined
}

/** The selection marker, and the state the picker forces on the selected element. */
function highlight(frame: HTMLIFrameElement | null, selected: string, state: State) {
  const doc = frame?.contentDocument
  if (!doc) return
  doc.querySelector('[data-freeflow-selected]')?.removeAttribute('data-freeflow-selected')
  doc.querySelector('[data-ff-state]')?.removeAttribute('data-ff-state')
  const element = nodeElement(doc, selected)
  element?.setAttribute('data-freeflow-selected', '')
  if (state !== 'none') element?.setAttribute('data-ff-state', state)
}

export function Canvas({
  onEditText,
  editingText,
  onNodeAction,
  bindDragSurface,
  html,
  width,
  state,
  states,
  onState,
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
  state: State
  states: State[]
  onState: (state: State) => void
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
  useEffect(() => () => selectionCleanup.current?.(), [])
  const dragCleanup = useRef<(() => void) | undefined>(undefined)
  useEffect(() => () => dragCleanup.current?.(), [])
  const frame = useRef<HTMLIFrameElement>(null)
  const scrollPosition = useRef({ x: 0, y: 0 })
  const motionReplay = useRef<(() => void) | undefined>(undefined)
  const restore = useRef<(() => void) | undefined>(undefined)
  const paint = () => {
    restore.current?.()
    const doc = frame.current?.contentDocument
    if (!doc) return
    const undo: (() => void)[] = []
    const draft = latest.current.livePreview
    if (draft.node) {
      let element = nodeElement(doc, draft.node.id)
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
        // No inline style can express a pseudo-class, so a state preview goes through a rule.
        const forced =
          draft.node.state && draft.node.state !== 'none' ? draft.node.selector : undefined
        const declarations: string[] = []
        for (const [property, value] of Object.entries(draft.node.styles)) {
          if (value !== null && forced) declarations.push(`${property}: ${value} !important;`)
          else if (value !== null) target.style.setProperty(property, value, 'important')
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
        if (forced && declarations.length) {
          const sheet = doc.createElement('style')
          sheet.textContent = `${forced} { ${declarations.join(' ')} }`
          doc.head.append(sheet)
          undo.push(() => sheet.remove())
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
  const shell = useRef<HTMLDivElement>(null)
  const [available, setAvailable] = useState(width)
  const zoom = Math.min(1, available / width)
  const reportStyles = () => {
    const doc = frame.current?.contentDocument
    const element = nodeElement(doc, latest.current.selected)
    const styles = element && doc?.defaultView?.getComputedStyle(element)
    latest.current.onComputed({
      id: latest.current.selected,
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
  // Everything the iframe listeners read long after the render that installed them.
  const current = {
    selectedName,
    onNodeAction,
    onEditText,
    livePreview,
    selected,
    state,
    states,
    onState,
    select,
    onHistory,
    onComputed,
    paint,
    reportStyles,
  }
  const latest = useRef(current)
  latest.current = current
  // biome-ignore lint/correctness/useExhaustiveDependencies: paint the latest draft into the iframe when the draft changes.
  useEffect(() => {
    latest.current.paint()
  }, [livePreview])
  // biome-ignore lint/correctness/useExhaustiveDependencies: width and state change the element's computed styles.
  useEffect(() => {
    highlight(frame.current, selected, state)
    latest.current.reportStyles()
  }, [selected, width, state])
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
      const { id } = (event as CustomEvent<{ id: string }>).detail
      if (id !== latest.current.selected) return
      cleanup?.()
      clearTimeout(timer)
      motionReplay.current = () => preview(event)
      const doc = frame.current?.contentDocument
      const element = nodeElement(doc, id)
      if (!doc || !element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      element.setAttribute('data-freeflow-motion', '')
      const before = element.getAttribute('style')
      cleanup = () => {
        element.removeAttribute('data-ff-enter')
        if (before === null) element.removeAttribute('style')
        else element.setAttribute('style', before)
        latest.current.paint()
      }
      const computed = doc.defaultView!.getComputedStyle(element)
      const duration = Number.parseFloat(computed.getPropertyValue('--ff-duration')) || 400
      const delay = Number.parseFloat(computed.getPropertyValue('--ff-delay')) || 0
      for (const property of ['opacity', 'translate']) {
        const value = element.style.getPropertyValue(property)
        if (value) element.style.setProperty(property, value)
      }
      element.removeAttribute('data-ff-enter')
      void element.offsetWidth
      element.setAttribute('data-ff-enter', '')
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
          selectionCleanup.current = selectionOverlay(
            doc,
            () => ({
              name: latest.current.selectedName,
              state: latest.current.state,
              states: latest.current.states,
            }),
            (next) => latest.current.onState(next),
          )
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
          const chrome = '[data-freeflow-editing], [data-freeflow-selection-overlay]'
          const pick = (event: Event) => {
            if ((event.target as Element | null)?.closest?.(chrome)) return
            event.preventDefault()
            event.stopPropagation()
            const target = event.target as Element | null
            const element = target?.closest?.('[data-freeflow-node]')
            const id = element?.getAttribute('data-freeflow-node')
            if (id) latest.current.select(id)
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
              latest.current.onEditText(id, element)
            }
          })
          doc.addEventListener('submit', (event) => event.preventDefault(), true)
          doc.addEventListener(
            'keydown',
            (event) => {
              if ((event.target as Element | null)?.closest?.(chrome)) return
              const direction = historyShortcut(event)
              if (direction) {
                event.preventDefault()
                latest.current.onHistory(direction)
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
                latest.current.onNodeAction('duplicate', latest.current.selected)
                return
              }
              if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault()
                latest.current.onNodeAction('delete', latest.current.selected)
                return
              }
              if (event.key === 'Enter' || event.key === ' ') pick(event)
            },
            true,
          )
          highlight(frame.current, latest.current.selected, latest.current.state)
          restore.current = undefined
          latest.current.paint()
          latest.current.reportStyles()
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
