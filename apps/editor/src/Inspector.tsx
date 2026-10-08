import { classNames, contextFromDocument, selectorFor, serializeValue } from '@lacuno/css'
import type { Operation } from '@lacuno/document'
import { assetUrl, canvasImage } from '@lacuno/renderer'
import type { CssValue, Document, Node, RichTag, State } from '@lacuno/schema'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { BindingControls, ListSettings } from './BindingControls.js'
import { boundFieldLabel } from './binding.js'
import { breakpointMedia } from './breakpoints.js'
import type { LivePreview } from './Canvas.js'
import { ClassManager } from './ClassManager.js'
import { CodeField, InfoButton } from './CodeField.js'
import { colorToken } from './colors.js'
import type { StyleEdit } from './colorWheel.js'
import { ErrorNote } from './Dialog.js'
import { EditorIcon } from './EditorIcon.js'
import { FormattingControls } from './FormattingControls.js'
import { FormControls, formTarget } from './FormControls.js'
import {
  clearStyles,
  draftCss,
  formattingOperations,
  invalidChange,
  localClass,
  localValue,
  normalizeFormatting,
  saveStatus,
} from './formatting.js'
import { type InspectorTab, InspectorTabs } from './InspectorTabs.js'
import { LinkTarget } from './LinkTarget.js'
import { MediaControls } from './MediaControls.js'
import { PresetManager } from './PresetManager.js'
import { TagPicker } from './RichTagInspector.js'
import { RotatingWordsControls } from './RotatingWordsControls.js'
import { isRichBlock } from './richTags.js'
import { applicableStates, stateInfo } from './states.js'
import { hasAnchorParent, isLocked, isShared, nodeLabel } from './structure.js'
import { useStyleField } from './styleField.js'
import { TextToolbar } from './TextToolbar.js'
import { textLink, textProperties, wholeText } from './textFormatting.js'
import { useAutosave } from './useAutosave.js'
import './inspector.css'

function editableText(node: Node): string | undefined {
  if (node.type !== 'text') return undefined
  if (node.text.type === 'static')
    return typeof node.text.value === 'string' ? node.text.value : undefined
  // The plain textarea must not flatten inline marks or content bindings.
  if (node.text.type === 'doc' && node.text.content?.length === 1) {
    const paragraph = node.text.content[0]
    const content = paragraph?.content as
      | { type: string; text?: string; marks?: unknown[] }[]
      | undefined
    if (
      paragraph?.type === 'paragraph' &&
      content?.every((item) => item.type === 'text' && !item.marks?.length)
    )
      return content.map((item) => item.text ?? '').join('')
  }
  return undefined
}

export function Inspector({
  siteId,
  breakpoint,
  state,
  doc,
  node,
  busy,
  conflict,
  save,
  autoSave,
  dirtyChanged,
  computed,
  previewChanged,
  registerFlush,
  clearSelection,
  selectTag,
  selectNode,
  tab,
  setTab,
  pageName,
  changeBreakpoint,
  changeState,
}: {
  tab: InspectorTab
  setTab: (tab: InspectorTab) => void
  pageName: string
  changeBreakpoint: (id: string) => void
  changeState: (state: State) => void
  siteId: string
  breakpoint: string
  state: State
  clearSelection: () => void
  selectTag: (tag: RichTag) => void
  selectNode: (id: string) => void
  previewChanged: (preview: LivePreview) => void
  registerFlush: (flush: () => Promise<boolean>) => () => void
  computed: Record<string, string>
  doc: Document
  node: Node
  busy: boolean
  conflict: boolean
  save: (ops: Operation[]) => Promise<boolean>
  autoSave: (ops: Operation[]) => Promise<boolean>
  dirtyChanged: (dirty: boolean) => void
}) {
  const isImage = node.type === 'element' && node.tag === 'img'
  const isVideo = node.type === 'element' && node.tag === 'video'
  const isLink = 'tag' in node && node.tag === 'a'
  const linkHref = isLink ? node.attrs?.href : undefined
  const link =
    linkHref?.type === 'page'
      ? { pageId: linkHref.page }
      : linkHref?.type === 'static'
        ? { href: String(linkHref.value) }
        : undefined
  const originalAlt = node.attrs?.alt?.type === 'static' ? String(node.attrs.alt.value) : ''
  const originalAsset = node.attrs?.src?.type === 'asset' ? node.attrs.src.asset : ''
  const [imageAlt, setImageAlt] = useState(originalAlt)
  const [imageAsset, setImageAsset] = useState(originalAsset)
  const imageDirty =
    (isImage || isVideo) && (imageAlt !== originalAlt || imageAsset !== originalAsset)
  const [embedHtml, setEmbedHtml] = useState(node.type === 'embed' ? node.html : '')
  const originalText = editableText(node)
  // A draft only once typed: the node may become plain text later, when a whole-text edit clears
  // its last range mark.
  const [draftText, setText] = useState<string>()
  const text = draftText ?? originalText ?? ''
  const [changes, setChanges] = useState<Record<string, CssValue | null>>({})
  const [classDraft, setClassDraft] = useState(false)
  const [presetDraft, setPresetDraft] = useState(false)
  const classId = useRef(`c-${crypto.randomUUID()}`)
  const normalized = normalizeFormatting(changes)
  const context = contextFromDocument(doc)
  const { serialized, supported } = draftCss(doc, normalized)
  const hasInlineOverride = (property: string) =>
    node.type === 'text' &&
    node.text.type === 'doc' &&
    JSON.stringify(wholeText(node, [property])) !== JSON.stringify(node.text)
  const pending = Object.fromEntries(
    Object.entries(normalized).filter(
      ([property, value]) =>
        JSON.stringify(value) !==
          JSON.stringify(localValue(doc, node, property, breakpoint, state) ?? null) ||
        hasInlineOverride(property),
    ),
  )
  const validation = invalidChange(pending, supported)
  const invalid = !!validation
  const textDirty = originalText !== undefined && text !== originalText
  const styleDirty = Object.keys(pending).length > 0
  const edits = textDirty || styleDirty || imageDirty
  const dirty = edits || classDraft || presetDraft
  const locked = isLocked(doc, node.id)
  const shared = isShared(doc, node.id)
  // Fields stay editable while a save runs; panel actions wait for a settled selection.
  const disabled = conflict || locked || classDraft || presetDraft
  const settled = !busy && !conflict && !locked && !edits
  const local = localClass(doc, node)
  const overrides = Object.values(doc.styles).filter(
    (style) => style.class === local && style.breakpoint === breakpoint && style.state === state,
  )
  const operations: Operation[] = []
  if (imageDirty)
    operations.push({
      type: 'node.update',
      id: node.id,
      attrs: {
        ...node.attrs,
        ...(imageAlt !== originalAlt ? { alt: { type: 'static' as const, value: imageAlt } } : {}),
        ...(imageAsset !== originalAsset && imageAsset
          ? { src: { type: 'asset' as const, asset: imageAsset } }
          : {}),
      },
    })
  if (textDirty)
    operations.push({
      type: 'node.update',
      id: node.id,
      text:
        node.type === 'text' && node.text.type === 'doc'
          ? {
              type: 'doc',
              content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }],
            }
          : { type: 'static', value: text },
    })
  if (!invalid)
    operations.push(
      ...formattingOperations(doc, node, pending, () => classId.current, breakpoint, state),
    )
  if (!invalid && !textDirty && node.type === 'text' && node.text.type === 'doc' && styleDirty) {
    const updated = wholeText(node, Object.keys(pending))
    if (JSON.stringify(updated) !== JSON.stringify(node.text))
      operations.push({ type: 'node.update', id: node.id, text: updated })
  }
  const [dragging, setDragging] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const autosave = useAutosave(operations, !disabled && !invalid && !dragging, busy, autoSave, {
    dirty,
    dirtyChanged,
    registerFlush,
  })
  // The canvas bar edits through the same draft as the panel: preview while dragging, one commit.
  const canvasStyle = useRef((_: StyleEdit & { id: string }) => {})
  canvasStyle.current = (edit) => {
    if (disabled) return
    // An edit for another node, such as Distribute on the parent, has no draft here: it commits.
    if (edit.id !== node.id) {
      const other = doc.nodes[edit.id]
      if (other && 'changes' in edit && edit.phase === 'commit')
        void autoSave(formattingOperations(doc, other, edit.changes, undefined, breakpoint, state))
      return
    }
    // The panel's autosave stays disabled while a canvas drag previews through its draft.
    setDragging('phase' in edit && edit.phase === 'drag')
    if ('token' in edit) {
      try {
        const create = colorToken(doc, edit.token.name, edit.token.value)
        void autoSave([
          create,
          ...formattingOperations(
            doc,
            node,
            { [edit.property]: { type: 'designToken', ref: create.id } },
            () => classId.current,
            breakpoint,
            state,
          ),
        ])
      } catch (error) {
        setTokenError((error as Error).message)
      }
      return
    }
    setTokenError('')
    // A single-property colour edit and a multi-side spacing edit share one changes object.
    const changed = 'changes' in edit ? edit.changes : { [edit.property]: edit.value }
    if (edit.phase === 'drag') {
      for (const [property, value] of Object.entries(changed)) changeFormatting(property, value)
      return
    }
    // Commit once when the drag ends as a single undoable edit. Like the panel's autosave, it keeps
    // the panel and its draft, so the canvas shows the new value until the new render lands.
    void autoSave(
      formattingOperations(doc, node, changed, () => classId.current, breakpoint, state),
    )
  }
  useEffect(() => {
    const listen = (event: Event) => canvasStyle.current((event as CustomEvent).detail)
    window.addEventListener('lacuno:canvas-style', listen)
    return () => window.removeEventListener('lacuno:canvas-style', listen)
  }, [])
  const previewKey = JSON.stringify({
    node: {
      id: node.id,
      media: breakpointMedia(doc, breakpoint),
      state,
      ...(local ? { selector: selectorFor(doc, classNames(doc), local, state, true) } : {}),
      ...(textDirty ? { text } : {}),
      ...(isImage || isVideo
        ? {
            attrs: {
              ...(node.attrs?.alt?.type === 'static' || imageAlt !== originalAlt
                ? { alt: imageAlt }
                : {}),
              // As the canvas renders it, so the sources of a picked image show at once.
              ...(doc.assets[imageAsset]
                ? isVideo
                  ? { src: assetUrl(siteId, doc.assets[imageAsset]!) }
                  : canvasImage(siteId, doc.assets[imageAsset]!)
                : {}),
            },
          }
        : {}),
      styles: Object.fromEntries(
        Object.keys(normalized)
          .filter((property) => supported[property])
          .map((property) => [property, serialized[property] ?? null]),
      ),
    },
  })
  useEffect(() => {
    previewChanged(JSON.parse(previewKey))
    return () => previewChanged({})
  }, [previewKey, previewChanged])
  const changeFormatting = (property: string, value: CssValue | null) =>
    setChanges((previous) => {
      const next = { ...previous }
      if (
        JSON.stringify(value) ===
          JSON.stringify(localValue(doc, node, property, breakpoint, state) ?? null) &&
        !hasInlineOverride(property)
      )
        delete next[property]
      else next[property] = value
      return next
    })
  const controls = {
    doc,
    node,
    computed,
    disabled,
    changes,
    change: changeFormatting,
    breakpoint,
    state,
    ...(node.parent && doc.nodes[node.parent]
      ? {
          parent: {
            label: nodeLabel(doc.nodes[node.parent]!),
            display: computed['__parent-display'] ?? '',
            direction: computed['__parent-direction'] ?? 'row',
            select: () => selectNode(node.parent!),
          },
        }
      : {}),
  }
  const { local: current, overridden } = useStyleField(controls)
  const boundField = boundFieldLabel(doc, node)
  const form = formTarget(doc, node)
  const flushOnEnter = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    if (
      event.key === 'Enter' &&
      event.target instanceof HTMLInputElement &&
      !event.target.closest('form')
    ) {
      event.preventDefault()
      void autosave.flush()
    }
  }
  const content = (
    <>
      {isLink && (
        <div className="link-target-row">
          <span>Link target</span>
          <strong>
            {linkHref?.type === 'field'
              ? `Field: ${boundField}`
              : link && 'pageId' in link
                ? (doc.pages[link.pageId]?.name ?? 'Unknown page')
                : (link?.href ?? 'No destination yet')}
          </strong>
          <LinkTarget
            doc={doc}
            label="Change"
            disabled={disabled || !settled}
            current={link}
            apply={(value) =>
              void save([
                {
                  type: 'node.update',
                  id: node.id,
                  attrs: {
                    ...node.attrs,
                    href: value.pageId
                      ? { type: 'page', page: value.pageId }
                      : { type: 'static', value: value.href ?? '' },
                  },
                },
              ])
            }
          />
        </div>
      )}
      <BindingControls
        key={node.id}
        doc={doc}
        node={node}
        disabled={disabled || !settled}
        save={save}
      />
      {node.type === 'collection-list' && (
        <ListSettings doc={doc} node={node} disabled={disabled || !settled} save={save} />
      )}
      <fieldset
        aria-label="Element properties"
        className="inspector-fields"
        onKeyDown={flushOnEnter}
      >
        {'tag' in node && (node.tag === 'ul' || node.tag === 'ol') && (
          <label>
            List type
            <select
              aria-label="List type"
              value={node.tag}
              disabled={disabled}
              onChange={(event) =>
                void autoSave([{ type: 'node.update', id: node.id, tag: event.target.value }])
              }
            >
              <option value="ul">Bulleted</option>
              <option value="ol">Numbered</option>
            </select>
          </label>
        )}
        {node.type === 'embed' && (
          <CodeField
            label="Embed code"
            info="Paste the HTML snippet a service gives you, such as a YouTube video, a map, a form or a social post. It is published exactly as written. The canvas shows only its static parts; scripts and iframes run on the published site, so a placeholder stands in here. The code saves when you leave the field."
            rows={8}
            placeholder={'<iframe src="https://…"></iframe>'}
            value={embedHtml}
            disabled={disabled}
            change={setEmbedHtml}
            commit={() => {
              if (embedHtml !== node.html)
                void autoSave([{ type: 'node.update', id: node.id, html: embedHtml }])
            }}
          />
        )}
        {(isImage || isVideo) && (
          <MediaControls
            {...controls}
            siteId={siteId}
            alt={imageAlt}
            setAlt={setImageAlt}
            asset={imageAsset}
            setAsset={setImageAsset}
            autoSave={autoSave}
          />
        )}
        {form && <FormControls doc={doc} node={form} disabled={disabled} save={autoSave} />}
        {originalText !== undefined ? (
          <label>
            Content
            <textarea
              aria-label="Text"
              rows={3}
              value={text}
              disabled={disabled}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        ) : node.type === 'text' && node.text.type !== 'field' ? (
          <p className="note">
            {node.text.type === 'doc'
              ? 'Double-click this text on the canvas to edit words, formatting, and links.'
              : 'This text is bound to content and cannot be edited directly.'}
          </p>
        ) : null}
      </fieldset>
      {!isLink &&
        !isImage &&
        !isVideo &&
        !form &&
        node.type === 'element' &&
        node.tag !== 'ul' &&
        node.tag !== 'ol' && (
          <p className="selection-hint">
            Select a text, image, or other child element to edit its content.
          </p>
        )}
    </>
  )
  const style = (
    <>
      <div className="inspector-presets">
        <PresetManager
          breakpoint={breakpoint}
          doc={doc}
          node={node}
          computed={computed}
          disabled={!settled || classDraft}
          save={save}
          draftChanged={setPresetDraft}
        />
      </div>
      {isRichBlock(doc, node) && <TagPicker disabled={disabled || !settled} choose={selectTag} />}
      <fieldset aria-label="Element styling" className="inspector-fields" onKeyDown={flushOnEnter}>
        <FormattingControls
          {...controls}
          focused
          words={
            node.type === 'text' ? (
              <RotatingWordsControls node={node} disabled={disabled} save={autoSave} />
            ) : undefined
          }
          typography={
            node.type === 'text' ? (
              <TextToolbar
                compact
                doc={doc}
                scope="Whole text"
                currentLink={textLink(node)}
                placeholders={computed}
                disabled={disabled}
                values={Object.fromEntries(
                  textProperties.map((property) => {
                    const value = current(property)
                    return [property, value ? serializeValue(value, context) : '']
                  }),
                )}
                change={(property, value) =>
                  changeFormatting(property, value ? { type: 'raw', value } : null)
                }
                tokens={{ value: current, set: changeFormatting }}
                overridden={overridden}
                linkDisabled={
                  !settled ||
                  (node.text.type !== 'doc' && node.text.type !== 'static') ||
                  node.tag === 'a' ||
                  hasAnchorParent(doc, node)
                }
                link={(attrs) =>
                  void save([
                    { type: 'node.update', id: node.id, text: wholeText(node, [], attrs) },
                  ])
                }
              />
            ) : undefined
          }
        />
      </fieldset>
    </>
  )
  const advanced = (
    <>
      <section className="inspector-shared-classes" aria-label="Shared classes">
        <h3>Shared classes</h3>
        <p className="hint">
          Reusable styles underneath this element. Direct formatting takes priority.
        </p>
        <ClassManager
          doc={doc}
          node={node}
          disabled={!settled || presetDraft}
          save={save}
          draftChanged={setClassDraft}
        />
      </section>
      <div className="inspector-reset">
        <button
          type="button"
          className="formatting-reset"
          aria-label="Reset formatting"
          title="Reset local formatting"
          disabled={disabled || !settled || !overrides.length}
          onClick={() => void save(clearStyles(doc, node, overrides, breakpoint, state))}
        >
          <EditorIcon name="reset" /> Reset formatting
        </button>
      </div>
    </>
  )
  return (
    <aside className="inspector focused-inspector">
      <div className="selection-heading">
        <span className="inspector-element-icon" title={'tag' in node ? node.tag : node.type}>
          <EditorIcon
            name={
              node.type === 'text'
                ? 'text'
                : isImage
                  ? 'image'
                  : isVideo
                    ? 'video'
                    : node.type === 'embed'
                      ? 'embed'
                      : 'container'
            }
          />
        </span>
        <div className="inspector-selection-context">
          <strong>{nodeLabel(node)}</strong>
          <div className="inspector-location">
            <span>{pageName}</span>
            {node.parent && doc.nodes[node.parent] && (
              <>
                <span aria-hidden="true">/</span>
                <button
                  type="button"
                  className="inspector-parent"
                  aria-label={`Select parent: ${nodeLabel(doc.nodes[node.parent]!)}`}
                  onClick={() => selectNode(node.parent!)}
                >
                  {nodeLabel(doc.nodes[node.parent]!)}
                </button>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="inspector-close"
          aria-label="Clear selection"
          onClick={clearSelection}
        >
          <EditorIcon name="close" />
        </button>
      </div>
      {boundField && (
        <div className="inspector-binding">
          <span className="field-chip" title={boundField}>
            <EditorIcon name="database" />
            <span>{boundField}</span>
          </span>
        </div>
      )}
      <div className="inspector-scope responsive-scope">
        <label className="inspector-breakpoint">
          <EditorIcon
            name={
              breakpoint === 'base'
                ? 'desktop'
                : breakpoint.startsWith('mobile')
                  ? 'mobile'
                  : 'tablet'
            }
          />
          <select
            aria-label="Editing breakpoint"
            value={breakpoint}
            disabled={busy || conflict}
            onChange={(event) => changeBreakpoint(event.target.value)}
          >
            {Object.values(doc.breakpoints).map((bp) => (
              <option key={bp.id} value={bp.id}>
                {bp.label}
              </option>
            ))}
          </select>
        </label>
        <select
          aria-label="Editing state"
          value={state}
          disabled={busy || conflict}
          onChange={(event) => changeState(event.target.value as State)}
        >
          {applicableStates(doc, node).map((item) => (
            <option key={item} value={item}>
              {stateInfo(item).label}
            </option>
          ))}
        </select>
        <InfoButton label="About responsive editing">
          {breakpoint === 'base' && state === 'none'
            ? `${overrides.length} local base styles. These apply to all sizes unless overridden.`
            : `${overrides.length} local overrides. Purple fields override this size or state; reset restores inheritance.`}{' '}
          Text and preset assignment apply to all sizes.
        </InfoButton>
      </div>
      <div className="inspector-body">
        {shared && <p className="note">Shared component. Changes appear in every instance.</p>}
        {locked && <p className="note">This element or its parent is locked.</p>}
        <InspectorTabs active={tab} change={setTab} panels={{ style, content, advanced }} />
        <div className="inspector-feedback" aria-live="polite">
          <ErrorNote message={validation || tokenError} />
          {(conflict || busy || edits || autosave.hasFailed) && (
            <p className="hint" role="status">
              {saveStatus({ conflict, validation, busy, pending: edits })}
            </p>
          )}
          {autosave.hasFailed && !conflict && (
            <button type="button" onClick={autosave.retry}>
              Retry changes
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
