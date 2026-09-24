import { contextFromDocument, serializeValue } from '@miralo/css'
import type { Operation } from '@miralo/document'
import {
  type CssValue,
  type Document,
  type RichText,
  safeLinkHref,
  safeTextStyleValue,
  type TextNode,
} from '@miralo/schema'
import { Editor, getSchema, type JSONContent, Mark } from '@tiptap/core'
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef, useState } from 'react'
import { formattingOperations, normalizeFormatting } from './formatting.js'
import { PresetManager } from './PresetManager.js'
import { TextToolbar } from './TextToolbar.js'
import { textDocument, textProperties, textStyleAttributes } from './textFormatting.js'

export type InlineTarget = { node: TextNode; element: HTMLElement }

export function InlineTextEditor({
  target,
  breakpoint,
  doc,
  disabled,
  save,
  close,
  registerFlush,
  dirtyChanged,
}: {
  breakpoint: string
  target: InlineTarget
  doc: Document
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
  close: () => void
  registerFlush: (flush: () => Promise<boolean>) => () => void
  dirtyChanged: (dirty: boolean) => void
}) {
  const [editor, setEditor] = useState<Editor>()
  const [, redraw] = useState(0)
  const blockChanges = useRef<Record<string, CssValue | null>>({})
  const baseline = useRef<Record<string, string>>({})
  const classId = useRef(`c-${crypto.randomUUID()}`)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const invalidDraft = useRef(false)
  const [error, setError] = useState('')
  const latest = useRef({ save, close, dirtyChanged, disabled })
  latest.current = { save, close, dirtyChanged, disabled }
  const initial = useRef('')
  const flush = useRef<() => Promise<boolean>>(async () => true)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the page map is captured for this editing session; saves must not remount the editor.
  useEffect(() => {
    const element = target.element
    const view = element.ownerDocument.defaultView
    const scroll = {
      left: view?.scrollX ?? 0,
      top: view?.scrollY ?? 0,
      behavior: 'instant' as const,
    }
    const markup = element.innerHTML
    const originalStyle = element.getAttribute('style')
    const computed = view?.getComputedStyle(element)
    baseline.current = Object.fromEntries(
      textProperties.map((property) => [property, computed?.getPropertyValue(property) ?? '']),
    )
    const content = textDocument(target.node.text)
    const Link = Mark.create({
      name: 'link',
      inclusive: false,
      addAttributes: () => ({
        href: { default: null },
        pageId: { default: null, parseHTML: (el) => el.getAttribute('data-page-id') },
        target: { default: null },
      }),
      parseHTML: () => [{ tag: 'a[href]' }],
      renderHTML: ({ HTMLAttributes }) => {
        const id = HTMLAttributes.pageId
        const href = safeLinkHref(id ? doc.pages[id]?.path : HTMLAttributes.href)
        return [
          'a',
          {
            href: href ?? '#',
            ...(id ? { 'data-page-id': id } : {}),
            ...(HTMLAttributes.target ? { target: HTMLAttributes.target, rel: 'noopener' } : {}),
          },
          0,
        ]
      },
    })
    const extensions = [
      StarterKit.configure({ link: false, trailingNode: false }),
      TextStyle.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            fontWeight: {
              default: null,
              parseHTML: (el) => el.style.fontWeight,
              renderHTML: (attrs) =>
                attrs.fontWeight ? { style: `font-weight:${attrs.fontWeight}` } : {},
            },
            fontStyle: {
              default: null,
              parseHTML: (el) => el.style.fontStyle,
              renderHTML: (attrs) =>
                attrs.fontStyle ? { style: `font-style:${attrs.fontStyle}` } : {},
            },
          }
        },
      }),
      FontFamily,
      Color,
      FontSize,
      Link,
    ]
    try {
      getSchema(extensions).nodeFromJSON(content).check()
    } catch {
      setError(
        'This text contains formatting the editor does not support yet. Cancel to keep it unchanged.',
      )
      return
    }
    const draggable: HTMLElement[] = []
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      if (parent.draggable) {
        draggable.push(parent)
        parent.draggable = false
      }
    }
    element.setAttribute('data-miralo-editing', '')
    element.innerHTML = ''
    const instance = new Editor({
      element,
      injectCSS: false,
      extensions,
      content: content as JSONContent,
      enableContentCheck: true,
      editorProps: {
        attributes: { 'aria-label': 'Canvas text editor', style: 'outline:none;min-height:1em;' },
        handleDOMEvents: {
          click: (_view, event) => {
            if ((event.target as Element)?.closest('a')) event.preventDefault()
            return false
          },
        },
        handleKeyDown: (_view, event) => {
          // Keep text nodes inline: Enter inserts a line break, not nested paragraphs in headings.
          if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
            instance.commands.setHardBreak()
            return true
          }
          return false
        },
      },
      onUpdate: ({ editor }) => {
        latest.current.dirtyChanged(
          JSON.stringify(editor.getJSON()) !== initial.current ||
            Object.keys(blockChanges.current).length > 0 ||
            invalidDraft.current,
        )
      },
      onSelectionUpdate: () => {
        if (!invalidDraft.current)
          setDrafts((previous) =>
            Object.fromEntries(Object.entries(previous).filter(([key]) => key === 'line-height')),
          )
      },
      // Every update and every selection change arrives here too, so one redraw covers them all.
      onTransaction: () => redraw((value) => value + 1),
    })
    initial.current = JSON.stringify(instance.getJSON())
    setEditor(instance)
    instance.commands.focus('end')
    flush.current = async () => {
      if (latest.current.disabled || invalidDraft.current) return false
      if (
        JSON.stringify(instance.getJSON()) === initial.current &&
        !Object.keys(blockChanges.current).length
      )
        return true
      const ok = await latest.current.save([
        { type: 'node.update', id: target.node.id, text: instance.getJSON() as RichText },
        ...formattingOperations(
          doc,
          target.node,
          blockChanges.current,
          () => classId.current,
          breakpoint,
        ),
      ])
      if (!ok)
        setError(
          'Could not save text. Your draft is still here; resolve the editor error and retry.',
        )
      return ok
    }
    const unregister = registerFlush(() => flush.current())
    return () => {
      instance.destroy()
      element.innerHTML = markup
      if (originalStyle === null) element.removeAttribute('style')
      else element.setAttribute('style', originalStyle)
      element.removeAttribute('data-miralo-editing')
      view?.scrollTo(scroll)
      for (const parent of draggable) parent.draggable = true
      unregister()
    }
  }, [target, registerFlush])
  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])
  const context = contextFromDocument(doc)
  const hasSelection = !!editor && !editor.state.selection.empty
  const attrs = editor?.getAttributes('textStyle') ?? {}
  const values = {
    ...baseline.current,
    'font-family': attrs.fontFamily ?? baseline.current['font-family'] ?? '',
    'font-size': attrs.fontSize ?? baseline.current['font-size'] ?? '',
    color: attrs.color ?? baseline.current.color ?? '',
    'font-weight': editor?.isActive('bold')
      ? '700'
      : (attrs.fontWeight ?? baseline.current['font-weight'] ?? ''),
    'font-style': editor?.isActive('italic')
      ? 'italic'
      : (attrs.fontStyle ?? baseline.current['font-style'] ?? ''),
    ...Object.fromEntries(
      Object.entries(blockChanges.current).map(([property, value]) => [
        property,
        value ? serializeValue(value, context) : '',
      ]),
    ),
    ...drafts,
  }
  const act = (
    action: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>,
    focus = true,
  ) => {
    if (!editor || disabled) return
    const selection = editor.state.selection
    let chain = editor.chain()
    if (focus) chain = chain.focus()
    if (selection.empty) chain = chain.selectAll()
    chain = action(chain)
    if (selection.empty) chain = chain.setTextSelection({ from: selection.from, to: selection.to })
    chain.run()
  }
  /** What one typed draft normalizes to, and whether the browser and the schema both take it. */
  const draftValue = (property: string, raw: string) => {
    const normalized = normalizeFormatting({
      [property]: raw ? { type: 'raw', value: raw } : null,
    })[property]
    const value = normalized ? serializeValue(normalized, context) : ''
    const accepted =
      !value ||
      (CSS.supports(property, value) &&
        (!textStyleAttributes[property] ||
          safeTextStyleValue(textStyleAttributes[property]!, value) !== undefined))
    return { normalized, value, accepted }
  }
  const change = (property: string, raw: string) => {
    const { normalized, value, accepted } = draftValue(property, raw)
    const nextDrafts = { ...drafts, [property]: raw }
    setDrafts(nextDrafts)
    invalidDraft.current = Object.entries(nextDrafts).some(([key, entry]) =>
      key === property ? !accepted : !draftValue(key, entry).accepted,
    )
    if (!accepted) {
      setError(
        property === 'font-size'
          ? 'Use a font size in px, em, rem, or %, such as 24px.'
          : `Enter a supported value for ${property}.`,
      )
      dirtyChanged(true)
      return
    }
    setError('')
    if (property === 'text-align' || property === 'line-height') {
      blockChanges.current[property] = normalized ?? null
      target.element.style.setProperty(property, value)
      dirtyChanged(true)
      return
    }
    const attribute = textStyleAttributes[property]
    if (!attribute) return
    act((chain) => {
      if (property === 'font-weight' && value === '700')
        return chain.setMark('textStyle', { fontWeight: null }).removeEmptyTextStyle().setBold()
      if (property === 'font-style' && value === 'italic')
        return chain.setMark('textStyle', { fontStyle: null }).removeEmptyTextStyle().setItalic()
      if (property === 'font-weight') chain = chain.unsetBold()
      if (property === 'font-style') chain = chain.unsetItalic()
      return chain.setMark('textStyle', { [attribute]: value || null }).removeEmptyTextStyle()
    }, false)
    // Only unfinished size/line-height input needs a local draft; mark values follow the selection.
    if (property !== 'font-size')
      setDrafts((previous) => {
        const next = { ...previous }
        delete next[property]
        return next
      })
  }
  return (
    <>
      <PresetManager
        breakpoint={breakpoint}
        doc={doc}
        node={target.node}
        computed={baseline.current}
        disabled
        save={save}
        draftChanged={ignoreDraft}
      />
      <TextToolbar
        doc={doc}
        scope={hasSelection ? 'Selected text' : 'Whole text'}
        values={values}
        disabled={disabled || !editor}
        linkDisabled={!!target.element.closest('a')}
        currentLink={editor?.getAttributes('link')}
        change={change}
        link={(attributes) =>
          act((chain) => (attributes ? chain.setMark('link', attributes) : chain.unsetMark('link')))
        }
      >
        <button
          type="button"
          aria-label="Undo text edit"
          disabled={disabled || !editor?.can().undo()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().undo().run()}
        >
          Undo
        </button>
        <button
          type="button"
          aria-label="Redo text edit"
          disabled={disabled || !editor?.can().redo()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor?.chain().focus().redo().run()}
        >
          Redo
        </button>
        <button
          type="button"
          aria-label="Done editing text"
          disabled={disabled || !editor || invalidDraft.current}
          onClick={async () => {
            if (await flush.current()) {
              dirtyChanged(false)
              close()
            }
          }}
        >
          Done
        </button>
        <button
          type="button"
          aria-label="Cancel text edit"
          disabled={disabled}
          onClick={() => {
            dirtyChanged(false)
            close()
          }}
        >
          Cancel
        </button>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </TextToolbar>
    </>
  )
}
const ignoreDraft = () => {}
