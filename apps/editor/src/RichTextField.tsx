import { type RichText, safeLinkHref } from '@lacuno/schema'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef, useState } from 'react'

const EMPTY: RichText = { type: 'doc', content: [{ type: 'paragraph' }] }

/** The marks and blocks an entry's rich text offers, with the command each button runs. */
const TOOLS: [label: string, text: string, active: [string, object?], run: (e: Editor) => void][] =
  [
    ['Bold', 'B', ['bold'], (e) => e.chain().focus().toggleBold().run()],
    ['Italic', 'I', ['italic'], (e) => e.chain().focus().toggleItalic().run()],
    [
      'Heading',
      'H2',
      ['heading', { level: 2 }],
      (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    ],
    [
      'Subheading',
      'H3',
      ['heading', { level: 3 }],
      (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    ],
    ['Bulleted list', '•', ['bulletList'], (e) => e.chain().focus().toggleBulletList().run()],
    ['Numbered list', '1.', ['orderedList'], (e) => e.chain().focus().toggleOrderedList().run()],
    ['Quote', '“', ['blockquote'], (e) => e.chain().focus().toggleBlockquote().run()],
  ]

/** Rich text for a CMS field: the editor's Tiptap document with a small toolbar and links. */
export function RichTextField({
  label,
  value,
  disabled,
  change,
}: {
  label: string
  value: RichText | undefined
  disabled: boolean
  change: (value: RichText) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<Editor>()
  const [, redraw] = useState(0)
  const [href, setHref] = useState<string>()
  const latest = useRef(change)
  latest.current = change
  // biome-ignore lint/correctness/useExhaustiveDependencies: the editor owns the text once mounted.
  useEffect(() => {
    const instance = new Editor({
      element: host.current!,
      extensions: [
        StarterKit.configure({
          trailingNode: false,
          link: { openOnClick: false, autolink: false, isAllowedUri: (url) => !!safeLinkHref(url) },
        }),
      ],
      content: (value ?? EMPTY) as JSONContent,
      editable: !disabled,
      editorProps: {
        attributes: { 'aria-label': label, role: 'textbox', 'aria-multiline': 'true' },
      },
      onUpdate: ({ editor }) => latest.current(editor.getJSON() as RichText),
      onTransaction: () => redraw((n) => n + 1),
    })
    setEditor(instance)
    return () => instance.destroy()
  }, [])
  useEffect(() => editor?.setEditable(!disabled), [editor, disabled])
  const applyLink = () => {
    if (!editor || href === undefined) return
    const safe = safeLinkHref(href)
    const chain = editor.chain().focus().extendMarkRange('link')
    if (safe) chain.setLink({ href: safe }).run()
    else chain.unsetLink().run()
    setHref(undefined)
  }
  return (
    <div className="rich-field" data-disabled={disabled}>
      {!disabled && (
        <div className="rich-field-tools" role="toolbar" aria-label={`${label} formatting`}>
          {TOOLS.map(([name, text, [mark, attrs], run]) => (
            <button
              type="button"
              key={name}
              title={name}
              aria-label={name}
              aria-pressed={!!editor?.isActive(mark, attrs)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor && run(editor)}
            >
              {text}
            </button>
          ))}
          <button
            type="button"
            title="Link"
            aria-label="Link"
            aria-pressed={!!editor?.isActive('link')}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setHref(String(editor?.getAttributes('link').href ?? ''))}
          >
            Link
          </button>
          {href !== undefined && (
            <span className="rich-field-link">
              <input
                aria-label="Link address"
                placeholder="https://… or /page"
                // biome-ignore lint/a11y/noAutofocus: the link button asks for the address it opened.
                autoFocus
                value={href}
                onChange={(event) => setHref(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    applyLink()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setHref(undefined)
                  }
                }}
              />
              <button type="button" onClick={applyLink}>
                {href ? 'Apply' : 'Remove'}
              </button>
            </span>
          )}
        </div>
      )}
      <div ref={host} className="rich-field-body" />
    </div>
  )
}
