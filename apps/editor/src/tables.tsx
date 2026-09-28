import { type Editor, Extension, type JSONContent } from '@tiptap/core'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Plugin } from '@tiptap/pm/state'
import './tables.css'

/** A table in a GitHub-style Markdown table, or nothing: a header row, a `| --- |` line, rows. */
export function markdownTable(text: string): JSONContent | undefined {
  const [head, line, ...body] = text.trim().split(/\r?\n/)
  if (!head?.includes('|') || !line?.includes('|') || !/^[\s|:-]*-[\s|:-]*$/.test(line)) return
  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim())
  const width = cells(head).length
  const row = (line: string, type: string) => ({
    type: 'tableRow',
    content: Array.from({ length: width }, (_, index) => {
      const text = cells(line)[index]
      return {
        type,
        content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
      }
    }),
  })
  return {
    type: 'table',
    content: [row(head, 'tableHeader'), ...body.map((line) => row(line, 'tableCell'))],
  }
}

/**
 * Enter at the very end of a table's last cell adds a row and moves into it, as Tab does. The
 * canvas calls it before its own Enter, which inserts a line break.
 */
export function enterAddsRow(editor: Editor): boolean {
  const { $head, empty } = editor.state.selection
  if (!empty || $head.depth < 4 || $head.parentOffset < $head.parent.content.size) return false
  const cell = $head.node(-1).type.name
  const last = (depth: number) => $head.index(depth) === $head.node(depth).childCount - 1
  if ((cell !== 'tableCell' && cell !== 'tableHeader') || !last(-1) || !last(-2) || !last(-3))
    return false
  return editor.chain().addRowAfter().goToNextCell().run()
}

/**
 * Tiptap's tables, drawn as the site draws them: in a `lc-table` region, so the canvas and the CMS
 * show what publishes. Enter in the last cell adds a row; a pasted Markdown table becomes a table.
 */
export const tableExtensions = [
  Table.configure({ View: null }).extend({
    renderHTML: ({ HTMLAttributes }) => [
      'div',
      { class: 'lc-table' },
      ['table', HTMLAttributes, ['tbody', 0]],
    ],
  }),
  TableRow,
  TableHeader,
  TableCell,
  Extension.create({
    name: 'tableInput',
    // Ahead of the paragraph's own Enter.
    priority: 1000,
    addKeyboardShortcuts() {
      return { Enter: () => enterAddsRow(this.editor) }
    },
    addProseMirrorPlugins() {
      const editor = this.editor
      return [
        new Plugin({
          props: {
            handlePaste: (_view, event) => {
              // Into a cell, pasted text stays text: tables do not nest.
              if (event.clipboardData?.types.includes('text/html') || editor.isActive('table'))
                return false
              const table = markdownTable(event.clipboardData?.getData('text/plain') ?? '')
              return !!table && editor.commands.insertContent(table)
            },
          },
        }),
      ]
    },
  }),
]

/** Inserts a three by three table with a header row at the caret. */
export const insertTable = (editor: Editor) =>
  editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()

/** The tools for the table the caret is in; nothing outside a table. */
export function TableTools({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  if (!editor.isActive('table')) return null
  const tool = (
    label: string,
    text: string,
    run: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>,
    pressed?: boolean,
  ) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => run(editor.chain().focus()).run()}
    >
      {text}
    </button>
  )
  const { $head } = editor.state.selection
  let depth = $head.depth
  while ($head.node(depth).type.name !== 'table') depth--
  let headerRow = true
  $head.node(depth).firstChild?.forEach((cell) => {
    if (cell.type.name !== 'tableHeader') headerRow = false
  })
  return (
    <div className="table-tools" role="toolbar" aria-label="Table">
      <span>Row</span>
      {tool('Add row above', 'Above', (chain) => chain.addRowBefore())}
      {tool('Add row below', 'Below', (chain) => chain.addRowAfter())}
      {tool('Delete row', 'Delete', (chain) => chain.deleteRow())}
      <span>Column</span>
      {tool('Add column left', 'Left', (chain) => chain.addColumnBefore())}
      {tool('Add column right', 'Right', (chain) => chain.addColumnAfter())}
      {tool('Delete column', 'Delete', (chain) => chain.deleteColumn())}
      <span>Table</span>
      {tool('Header row', 'Header row', (chain) => chain.toggleHeaderRow(), headerRow)}
      {tool('Delete table', 'Delete', (chain) => chain.deleteTable())}
    </div>
  )
}
