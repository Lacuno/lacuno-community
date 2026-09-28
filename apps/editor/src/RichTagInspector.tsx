import { classNames, selectorFor } from '@lacuno/css'
import type { Operation } from '@lacuno/document'
import { type CssValue, type Document, type Node, RichTag, type State } from '@lacuno/schema'
import { useEffect, useRef, useState } from 'react'
import type { LivePreview } from './Canvas.js'
import { ErrorNote } from './Dialog.js'
import { EditorIcon } from './EditorIcon.js'
import { FormattingControls } from './FormattingControls.js'
import { draftCss, invalidChange, normalizeFormatting, saveStatus } from './formatting.js'
import {
  RICH_TAG_NAMES,
  richClass,
  richClassName,
  tagStyleOperations,
  tagValue,
} from './richTags.js'
import { stateInfo } from './states.js'
import { isLocked, nodeLabel } from './structure.js'
import { useAutosave } from './useAutosave.js'

/** Switches the inspector to any tag of the rich text, also one its content does not hold yet. */
export function TagPicker({
  tag,
  disabled,
  choose,
}: {
  tag?: RichTag
  disabled: boolean
  choose: (tag: RichTag) => void
}) {
  return (
    <label className="tag-picker">
      {tag ? 'Style other tags' : 'Style tags inside'}
      <select
        aria-label="Style other tags"
        value={tag ?? ''}
        disabled={disabled}
        onChange={(event) => choose(event.target.value as RichTag)}
      >
        {!tag && <option value="">Choose a tag…</option>}
        {RichTag.options.map((option) => (
          <option key={option} value={option}>
            {RICH_TAG_NAMES[option]}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Styles one tag inside a rich-text block, "H2 in Legal body": the values are rules of the block's
 * class, so every block carrying it follows, on every page.
 */
export function RichTagInspector({
  doc,
  node,
  tag,
  breakpoint,
  state,
  computed,
  busy,
  conflict,
  autoSave,
  dirtyChanged,
  registerFlush,
  previewChanged,
  selectBlock,
  selectTag,
  clearSelection,
}: {
  doc: Document
  node: Node
  tag: RichTag
  breakpoint: string
  state: State
  computed: Record<string, string>
  busy: boolean
  conflict: boolean
  autoSave: (operations: Operation[]) => Promise<boolean>
  dirtyChanged: (dirty: boolean) => void
  registerFlush: (flush: () => Promise<boolean>) => () => void
  previewChanged: (preview: LivePreview) => void
  selectBlock: () => void
  selectTag: (tag: RichTag) => void
  clearSelection: () => void
}) {
  const [changes, setChanges] = useState<Record<string, CssValue | null>>({})
  const classId = useRef(`c-${crypto.randomUUID()}`)
  const read = (property: string) => tagValue(doc, node, tag, property, breakpoint, state)
  const normalized = normalizeFormatting(changes)
  const { serialized, supported } = draftCss(doc, normalized)
  const pending = Object.fromEntries(
    Object.entries(normalized).filter(
      ([property, value]) => JSON.stringify(value) !== JSON.stringify(read(property) ?? null),
    ),
  )
  const validation = invalidChange(pending, supported)
  const disabled = conflict || isLocked(doc, node.id)
  const operations = validation
    ? []
    : tagStyleOperations(doc, node, tag, pending, breakpoint, state, () => classId.current)
  const dirty = Object.keys(pending).length > 0
  const autosave = useAutosave(operations, !disabled && !validation, busy, autoSave, {
    dirty,
    dirtyChanged,
    registerFlush,
  })
  // Drafts paint over every tag the rule will reach: all blocks of the class, else this block.
  const cls = richClass(doc, node)
  const selector = cls
    ? selectorFor(doc, classNames(doc), cls, state, true, tag)
    : `[data-lacuno-node="${CSS.escape(node.id)}"] ${tag}`
  const declarations = Object.entries(serialized)
    .filter(([property, text]) => text && supported[property])
    .map(([property, text]) => `${property}: ${text} !important;`)
  const rule = declarations.length ? `${selector} { ${declarations.join(' ')} }` : ''
  useEffect(() => {
    previewChanged(rule ? { rule } : {})
    return () => previewChanged({})
  }, [rule, previewChanged])
  const change = (property: string, value: CssValue | null) =>
    setChanges((previous) => ({ ...previous, [property]: value }))
  return (
    <aside className="inspector">
      <div className="selection-heading">
        <button type="button" className="inspector-parent" onClick={selectBlock}>
          {nodeLabel(node)}
        </button>
        <EditorIcon name="chevron" />
        <strong>
          {RICH_TAG_NAMES[tag]} in {richClassName(doc, node)}
        </strong>
        <button
          type="button"
          className="inspector-close"
          aria-label="Clear selection"
          onClick={clearSelection}
        >
          <EditorIcon name="close" />
        </button>
      </div>
      <div className="inspector-body">
        <div className="responsive-scope">
          <span>{doc.breakpoints[breakpoint]?.label ?? breakpoint}</span>
          {state !== 'none' && (
            <span className="state-badge" title="Every change here applies to this state">
              {stateInfo(state).label}
            </span>
          )}
        </div>
        <TagPicker tag={tag} disabled={disabled} choose={selectTag} />
        <fieldset aria-label="Tag styles" className="inspector-fields">
          <FormattingControls
            doc={doc}
            node={node}
            computed={computed}
            disabled={disabled}
            changes={changes}
            change={change}
            breakpoint={breakpoint}
            state={state}
            read={read}
          />
          <ErrorNote message={validation} />
          <p className="hint" role="status">
            {saveStatus({ conflict, validation, busy, pending: dirty })}
          </p>
          {autosave.hasFailed && !conflict && (
            <button type="button" onClick={autosave.retry}>
              Retry changes
            </button>
          )}
        </fieldset>
      </div>
    </aside>
  )
}
