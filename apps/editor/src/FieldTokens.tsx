import type { Document, FieldToken, Node, RichText } from '@lacuno/schema'
import { type Editor, mergeAttributes, Node as TiptapNode } from '@tiptap/core'
import { useState } from 'react'
import { EntryPicker } from './BindingControls.js'
import { bindableFields, bindingSource, nearbyEntry, scopeCollection } from './binding.js'
import { DateFormatControls, nodeLang } from './DateFormatControls.js'

const ATTRS = ['field', 'entry', 'format', 'locale'] as const

/** A field inside written text, "Written by {Author}": a chip with the field's name while editing. */
export function fieldTokenNode(doc: Document, node: Node) {
  return TiptapNode.create({
    name: 'field',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    addAttributes: () => Object.fromEntries(ATTRS.map((name) => [name, { default: null }])),
    parseHTML: () => [{ tag: 'span[data-lacuno-field]' }],
    renderHTML: ({ node: token, HTMLAttributes }) => [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-lacuno-field': '' }),
      fieldName(doc, node, token.attrs as FieldToken),
    ],
  })
}

const fieldName = (doc: Document, node: Node, token: FieldToken) =>
  bindingSource(doc, node.id, { type: 'field', ...token }).collection?.fields.find(
    (field) => field.id === token.field,
  )?.label ?? 'Missing field'

/** The editor's JSON as stored: a field keeps only the attributes it sets. */
export function storedText(json: RichText): RichText {
  const clean = (item: Record<string, unknown>): Record<string, unknown> => ({
    ...item,
    ...(item.type === 'field'
      ? {
          attrs: Object.fromEntries(
            Object.entries(item.attrs as object).filter(([, value]) => value != null),
          ),
        }
      : {}),
    ...(Array.isArray(item.content) ? { content: item.content.map(clean) } : {}),
  })
  return clean(json) as RichText
}

/**
 * Inserting a field at the caret: one of the entry around the text, or of an entry chosen from
 * the CMS; a selected date field takes a format.
 */
export function InsertField({
  doc,
  node,
  editor,
  disabled,
}: {
  doc: Document
  node: Node
  editor: Editor
  disabled: boolean
}) {
  const [picking, setPicking] = useState(false)
  const col = scopeCollection(doc, node.id)
  const insert = (field: string, entry?: string) => {
    setPicking(false)
    editor
      .chain()
      .focus()
      .insertContent({ type: 'field', attrs: { field, ...(entry ? { entry } : {}) } })
      .run()
  }
  const token = editor.isActive('field')
    ? (storedText({
        type: 'doc',
        content: [{ type: 'field', attrs: editor.getAttributes('field') }],
      }).content?.[0]?.attrs as FieldToken)
    : undefined
  const at = editor.state.selection.from
  const date =
    token &&
    bindingSource(doc, node.id, { type: 'field', ...token }).collection?.fields.find(
      (field) => field.id === token.field,
    )?.type === 'date'
  return (
    <div className="insert-field">
      <select
        aria-label="Insert field"
        value={picking ? 'pick' : ''}
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value
          if (value === 'pick') setPicking(true)
          else if (value) insert(value)
        }}
      >
        <option value="">Insert field…</option>
        {col &&
          bindableFields(doc, col, 'inline').map((field) => (
            <option key={field.id} value={field.id}>
              {col.name} · {field.label}
            </option>
          ))}
        <option value="pick">From the CMS…</option>
      </select>
      {picking && (
        <EntryPicker
          doc={doc}
          slot="inline"
          start={nearbyEntry(doc, node.id)}
          disabled={disabled}
          choose={(entry, field) => insert(field, entry)}
          cancel={() => setPicking(false)}
        />
      )}
      {date && (
        <DateFormatControls
          format={token.format}
          locale={token.locale}
          lang={nodeLang(doc, node)}
          disabled={disabled}
          // The field stays selected for the next choice, its language.
          change={(value) =>
            editor
              .chain()
              .focus()
              .setNodeSelection(at)
              .updateAttributes('field', {
                format: value.format ?? null,
                locale: value.locale ?? null,
              })
              .setNodeSelection(at)
              .run()
          }
        />
      )}
    </div>
  )
}
