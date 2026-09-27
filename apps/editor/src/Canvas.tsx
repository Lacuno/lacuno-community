import { MOTION_CSS, sizeWords } from '@lacuno/css'
import type { State } from '@lacuno/schema'
import { Idiomorph } from 'idiomorph'
import { useEffect, useRef, useState } from 'react'
import type { StyleEdit, Swatch } from './colorWheel.js'
import { formattingGroups } from './formatting.js'
import { historyShortcut } from './history.js'
import { type Selection, selectionOverlay } from './selectionOverlay.js'

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
  return doc?.querySelector<HTMLElement>(`[data-lacuno-node="${CSS.escape(id)}"]`) ?? undefined
}

/** The selection marker, and the state the picker forces on the selected element. */
function highlight(frame: HTMLIFrameElement | null, selected: string, state: State) {
  const doc = frame?.contentDocument
  if (!doc) return
  doc.querySelector('[data-lacuno-selected]')?.removeAttribute('data-lacuno-selected')
  doc.querySelector('[data-lc-state]')?.removeAttribute('data-lc-state')
  const element = nodeElement(doc, selected)
  element?.setAttribute('data-lacuno-selected', '')
  if (state !== 'none') element?.setAttribute('data-lc-state', state)
}

/** The text of every style in a rendered head, in order. */
const headStyles = (doc: Document) =>
  [...doc.head.querySelectorAll('style')].map((style) => style.textContent).join('\n')

/**
 * A server `<img>` or `<video>` with no source is an empty slot, shown as a placeholder instead.
 * An embed whose markup shows nothing here (scripts and frames never run on the canvas) gets a
 * labelled placeholder so it can still be selected and sized.
 */
function swapPlaceholders(doc: Document) {
  for (const media of doc.querySelectorAll(
    ':is(img, video)[data-lacuno-node]:not([src]), :is(img, video)[data-lacuno-node][src=""]',
  )) {
    const placeholder = doc.createElement('div')
    for (const attribute of media.attributes)
      placeholder.setAttribute(attribute.name, attribute.value)
    if (media.tagName === 'VIDEO') placeholder.setAttribute('data-lacuno-placeholder', 'Video')
    else {
      placeholder.setAttribute('data-lacuno-image-placeholder', '')
      placeholder.setAttribute('aria-label', 'Image placeholder. Drop a photo here.')
    }
    media.replaceWith(placeholder)
  }
  for (const embed of doc.querySelectorAll<HTMLElement>('[data-lacuno-embed]'))
    if (
      !embed.innerText.trim() &&
      !embed.querySelector(':not(script, style, iframe, noscript, template)')
    )
      embed.setAttribute('data-lacuno-placeholder', 'Embed')
}

export function Canvas({
  onEditText,
  editingText,
  onNodeAction,
  bindDragSurface,
  html,
  width,
  scale,
  state,
  states,
  onState,
  scope,
  textColor,
  swatches,
  tokens,
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
  scale?: number | undefined
  state: State
  states: State[]
  onState: (state: State) => void
  scope: string
  textColor: boolean
  swatches: Swatch[]
  tokens: Selection['tokens']
  selected: string
  selectedName: string
  select: (id: string) => void
  onHistory: (direction: 'undo' | 'redo') => void
  onComputed: (value: { id: string; values: Record<string, string> }) => void
}) {
  // The iframe loads this once; every later render morphs the live document in place instead.
  const initialHtml = useRef(html)
  const loaded = useRef(false)
  const selectionCleanup = useRef<(() => void) | undefined>(undefined)
  // The sidebar spacing input with focus, forwarded to the overlay so it shows the boxes.
  const spacingFocus = useRef<Selection['spacingFocus']>(null)
  // The nodes an agent batch just changed, outlined on the canvas until `until`.
  const flash = useRef({ ids: [] as string[], until: 0 })
  const dragCleanup = useRef<(() => void) | undefined>(undefined)
  useEffect(
    () => () => {
      selectionCleanup.current?.()
      dragCleanup.current?.()
    },
    [],
  )
  const frame = useRef<HTMLIFrameElement>(null)
  // The generated stylesheet element, swapped by text on every morph.
  const generatedStyle = useRef<HTMLStyleElement | null>(null)
  const restore = useRef<(() => void) | undefined>(undefined)
  const paint = () => {
    restore.current?.()
    const doc = frame.current?.contentDocument
    if (!doc) return
    const undo: (() => void)[] = []
    const draft = latest.current.livePreview
    if (draft.node) {
      let element = nodeElement(doc, draft.node.id)
      if (element?.hasAttribute('data-lacuno-image-placeholder') && draft.node.attrs?.src) {
        const placeholder = element
        const image = doc.createElement('img')
        for (const attribute of placeholder.attributes) {
          if (attribute.name !== 'data-lacuno-image-placeholder')
            image.setAttribute(attribute.name, attribute.value)
        }
        placeholder.replaceWith(image)
        element = image
        undo.push(() => image.replaceWith(placeholder))
      }
      if (element && !element.hasAttribute('data-lacuno-editing')) {
        const target = element
        // Style previews must preserve child DOM, including its current selection marker.
        const markup = draft.node.text !== undefined ? target.innerHTML : undefined
        const style = target.getAttribute('style')
        undo.push(() => {
          if (target.hasAttribute('data-lacuno-editing')) return
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
  const zoom = scale ?? Math.min(1, available / width)
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
    scope,
    textColor,
    swatches,
    tokens,
    select,
    onHistory,
    onComputed,
    paint,
    reportStyles,
  }
  const latest = useRef(current)
  latest.current = current
  const refresh = (doc: Document) => {
    swapPlaceholders(doc)
    // querySelectorAll types its matches as Element; the rotating-word lists are HTML elements.
    sizeWords(doc as unknown as Parameters<typeof sizeWords>[0])
    for (const element of doc.querySelectorAll<HTMLElement>('[data-lacuno-node]'))
      element.draggable = true
    highlight(frame.current, latest.current.selected, latest.current.state)
    latest.current.paint()
    latest.current.reportStyles()
  }
  // Reconcile the live document to a new server render without reloading the iframe: swap the
  // generated stylesheet's text, morph the body to the new markup (keyed on tag/position, editor
  // chrome kept), then re-derive the placeholders, selection and draft the way a reload used to.
  const morph = (next: string) => {
    const doc = frame.current?.contentDocument
    const generated = generatedStyle.current
    if (!doc || !generated) return
    restore.current?.()
    restore.current = undefined
    const parsed = new DOMParser().parseFromString(next, 'text/html')
    generated.textContent = headStyles(parsed)
    // The body's children, not the body itself: idiomorph would otherwise nest a second <body>.
    Idiomorph.morph(doc.body, [...parsed.body.childNodes], {
      morphStyle: 'innerHTML',
      callbacks: {
        beforeNodeRemoved: (node) =>
          !(node as Element).matches?.(
            '[data-lacuno-selection-overlay], [data-lacuno-drop-indicator]',
          ),
      },
    })
    refresh(doc)
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: morph the new render in place; an open text editor freezes it.
  useEffect(() => {
    if (loaded.current && !editingText) morph(html)
  }, [html, editingText])
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
      const doc = frame.current?.contentDocument
      const element = nodeElement(doc, id)
      if (!doc || !element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const motion = element.hasAttribute('data-lacuno-motion')
      element.setAttribute('data-lacuno-motion', '')
      const before = element.getAttribute('style')
      cleanup = () => {
        element.toggleAttribute('data-lacuno-motion', motion)
        element.removeAttribute('data-lc-enter')
        if (before === null) element.removeAttribute('style')
        else element.setAttribute('style', before)
        latest.current.paint()
      }
      const computed = doc.defaultView!.getComputedStyle(element)
      const duration = Number.parseFloat(computed.getPropertyValue('--lc-duration')) || 400
      const delay = Number.parseFloat(computed.getPropertyValue('--lc-delay')) || 0
      element.removeAttribute('data-lc-enter')
      void element.offsetWidth
      element.setAttribute('data-lc-enter', '')
      timer = setTimeout(
        () => {
          cleanup?.()
          cleanup = undefined
        },
        duration + delay + 500,
      )
    }
    const focus = (event: Event) => {
      spacingFocus.current = (event as CustomEvent<Selection['spacingFocus']>).detail
    }
    const flashNodes = (event: Event) => {
      flash.current = { ids: (event as CustomEvent<string[]>).detail, until: Date.now() + 1000 }
    }
    window.addEventListener('lacuno:motion-preview', preview)
    window.addEventListener('lacuno:spacing-focus', focus)
    window.addEventListener('lacuno:flash', flashNodes)
    return () => {
      window.removeEventListener('lacuno:motion-preview', preview)
      window.removeEventListener('lacuno:spacing-focus', focus)
      window.removeEventListener('lacuno:flash', flashNodes)
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
        srcDoc={initialHtml.current}
        style={{
          width,
          height: `${100 / zoom}%`,
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
        }}
        onLoad={() => {
          const doc = frame.current?.contentDocument
          if (!doc) return
          // The render's head styles (font faces, then the generated CSS) become one stylesheet
          // whose text every morph swaps in place, so a new font shows without a reload.
          const styles = [...doc.head.querySelectorAll('style')]
          generatedStyle.current = styles.pop() ?? null
          if (generatedStyle.current) generatedStyle.current.textContent = headStyles(doc)
          for (const style of styles) style.remove()
          selectionCleanup.current?.()
          selectionCleanup.current = selectionOverlay(
            doc,
            () => ({
              name: latest.current.selectedName,
              scope: latest.current.scope,
              state: latest.current.state,
              states: latest.current.states,
              textColor: latest.current.textColor,
              swatches: latest.current.swatches,
              tokens: latest.current.tokens,
              spacingFocus: spacingFocus.current,
              flash: Date.now() < flash.current.until ? flash.current.ids : [],
            }),
            (next) => latest.current.onState(next),
            (edit: StyleEdit) =>
              window.dispatchEvent(
                new CustomEvent('lacuno:canvas-style', {
                  detail: { id: latest.current.selected, ...edit },
                }),
              ),
          )
          dragCleanup.current?.()
          dragCleanup.current = bindDragSurface(doc)
          const style = doc.createElement('style')
          style.textContent =
            'div[data-lacuno-node]:empty, section[data-lacuno-node]:empty { min-height: 48px; min-width: 48px; } [data-lacuno-node]:not([data-lacuno-selected]):hover:not(:has([data-lacuno-node]:hover)) { outline: 1px solid #8775ed !important; outline-offset: -1px }'
          style.textContent += `[data-lacuno-image-placeholder] { min-height:160px !important; min-width:80px; background: #f2f0f7; border:1px dashed #b7afc9; box-sizing:border-box; position:relative; } [data-lacuno-image-placeholder]::after { content:""; display:block; width:40px; height:40px; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); background:center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' fill='none' stroke='%239187aa' stroke-width='1.5'%3E%3Cpath d='M3 4h26v24H3zM3 24l9-11 7 8 4-5 6 8'/%3E%3Ccircle cx='22' cy='10' r='2'/%3E%3C/svg%3E"); }`
          style.textContent +=
            '[data-lacuno-placeholder] { display:grid; place-items:center; min-height:120px !important; padding:12px; background:#f2f0f7; border:1px dashed #b7afc9; box-sizing:border-box; font:12px/1.4 system-ui, sans-serif; color:#6f6787; text-align:center; } [data-lacuno-placeholder]::before { content:attr(data-lacuno-placeholder); } [data-lacuno-placeholder="Embed"]::before { content:"Embed. Scripts and iframes run on the published site."; } [data-lacuno-placeholder] iframe { display:none; }'
          style.textContent += MOTION_CSS
          style.textContent +=
            '[data-lacuno-editing] .tiptap {font:inherit;color:inherit;line-height:inherit;letter-spacing:inherit;cursor:text;user-select:text;} [data-lacuno-editing] .tiptap p {font:inherit;color:inherit;line-height:inherit;letter-spacing:inherit;margin:0;} [data-lacuno-editing] .tiptap strong {font-weight:bold;} [data-lacuno-editing] .tiptap em {font-style:italic;}'
          doc.head.append(style)
          const chrome = '[data-lacuno-editing], [data-lacuno-selection-overlay]'
          const pick = (event: Event) => {
            if ((event.target as Element | null)?.closest?.(chrome)) return
            event.preventDefault()
            event.stopPropagation()
            const target = event.target as Element | null
            const element = target?.closest?.('[data-lacuno-node]')
            const id = element?.getAttribute('data-lacuno-node')
            if (id) latest.current.select(id)
          }
          doc.addEventListener('click', pick, true)
          doc.addEventListener('auxclick', pick, true)
          doc.addEventListener('dblclick', (event) => {
            const element = (event.target as Element | null)?.closest?.<HTMLElement>(
              '[data-lacuno-node]',
            )
            const id = element?.dataset.lacunoNode
            if (id && element && !element.hasAttribute('data-lacuno-editing')) {
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
          restore.current = undefined
          refresh(doc)
          loaded.current = true
        }}
      />
    </div>
  )
}
