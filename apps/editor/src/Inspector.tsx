import { classNames, contextFromDocument, selectorFor, serializeValue } from '@freeflow/css'
import type { Operation } from '@freeflow/document'
import type { CssValue, Document, Node } from '@freeflow/schema'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { assetUrl } from './AssetsPanel.js'
import { breakpointMedia } from './breakpoints.js'
import type { LivePreview } from './Canvas.js'
import { ClassManager } from './ClassManager.js'
import { ErrorNote } from './Dialog.js'
import { EditorIcon } from './EditorIcon.js'
import { FormattingControls } from './FormattingControls.js'
import { formattingOperations, localClass, localValue, normalizeFormatting } from './formatting.js'
import { ImageLibrary } from './ImageLibrary.js'
import { PresetManager } from './PresetManager.js'
import { placePopover } from './popover.js'
import { isLocked, isShared, nodeLabel } from './structure.js'
import { TextToolbar } from './TextToolbar.js'
import { textLink, textProperties, wholeText } from './textFormatting.js'
import { useAutosave } from './useAutosave.js'

function hasAnchorParent(doc: Document, node: Node): boolean {
  for (
    let parent = node.parent ? doc.nodes[node.parent] : undefined;
    parent;
    parent = parent.parent ? doc.nodes[parent.parent] : undefined
  ) {
    if ('tag' in parent && parent.tag === 'a') return true
  }
  return false
}

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
  ribbonHost,
  ribbonGroup,
}: {
  siteId: string
  breakpoint: string
  ribbonHost: HTMLDivElement | null
  ribbonGroup: string
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
  const scopeInfoId = useId()
  const scopeInfo = useRef<HTMLDivElement>(null)
  const isImage = node.type === 'element' && node.tag === 'img'
  const originalAlt = node.attrs?.alt?.type === 'static' ? String(node.attrs.alt.value) : ''
  const originalAsset = node.attrs?.src?.type === 'asset' ? node.attrs.src.asset : ''
  const [imageAlt, setImageAlt] = useState(originalAlt)
  const [imageAsset, setImageAsset] = useState(originalAsset)
  const [imageLibraryOpen, setImageLibraryOpen] = useState(false)
  const imageDirty = isImage && (imageAlt !== originalAlt || imageAsset !== originalAsset)
  const originalText = editableText(node)
  const [text, setText] = useState(originalText ?? '')
  const [changes, setChanges] = useState<Record<string, CssValue | null>>({})
  const [classDraft, setClassDraft] = useState(false)
  const [presetDraft, setPresetDraft] = useState(false)
  const classId = useRef(`c-${crypto.randomUUID()}`)
  const normalized = normalizeFormatting(changes)
  const context = contextFromDocument(doc)
  const serialized = Object.fromEntries(
    Object.entries(normalized).map(([property, value]) => [
      property,
      value && serializeValue(value, context),
    ]),
  )
  const supported = Object.fromEntries(
    Object.entries(serialized).map(([property, text]) => [
      property,
      !text || CSS.supports(property, text),
    ]),
  )
  const hasInlineOverride = (property: string) =>
    node.type === 'text' &&
    node.text.type === 'doc' &&
    JSON.stringify(wholeText(node, [property])) !== JSON.stringify(node.text)
  const pending = Object.fromEntries(
    Object.entries(normalized).filter(
      ([property, value]) =>
        JSON.stringify(value) !==
          JSON.stringify(localValue(doc, node, property, breakpoint) ?? null) ||
        hasInlineOverride(property),
    ),
  )
  const invalid = Object.entries(pending).find(
    ([property, value]) => value && value.type !== 'designToken' && !supported[property],
  )
  const validation = invalid
    ? `Enter a valid value for ${invalid[0]}, such as 24px or #334155.`
    : ''
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
    (style) => style.class === local && style.breakpoint === breakpoint && style.state === 'none',
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
    operations.push(...formattingOperations(doc, node, pending, () => classId.current, breakpoint))
  if (!invalid && !textDirty && node.type === 'text' && node.text.type === 'doc' && styleDirty) {
    const updated = wholeText(node, Object.keys(pending))
    if (JSON.stringify(updated) !== JSON.stringify(node.text))
      operations.push({ type: 'node.update', id: node.id, text: updated })
  }
  const autosave = useAutosave(operations, !disabled && !invalid, busy, autoSave, {
    dirty,
    dirtyChanged,
    registerFlush,
  })
  const previewKey = JSON.stringify({
    node: {
      id: node.id,
      media: breakpointMedia(doc, breakpoint),
      ...(local ? { selector: selectorFor(doc, classNames(doc), local, 'none') } : {}),
      ...(originalText !== undefined ? { text } : {}),
      ...(isImage
        ? {
            attrs: {
              ...(node.attrs?.alt?.type === 'static' || imageAlt !== originalAlt
                ? { alt: imageAlt }
                : {}),
              ...(doc.assets[imageAsset]
                ? { src: assetUrl(siteId, doc.assets[imageAsset]!.hash) }
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
          JSON.stringify(localValue(doc, node, property, breakpoint) ?? null) &&
        !hasInlineOverride(property)
      )
        delete next[property]
      else next[property] = value
      return next
    })
  const controls = { doc, node, computed, disabled, changes, change: changeFormatting, breakpoint }
  const resetFormatting = () =>
    void save(
      formattingOperations(
        doc,
        node,
        Object.fromEntries(overrides.map((style) => [style.property, null])),
        undefined,
        breakpoint,
      ),
    )
  return (
    <aside className="inspector">
      {ribbonHost &&
        createPortal(
          <>
            {ribbonGroup === 'Typography' && (
              <PresetManager
                breakpoint={breakpoint}
                doc={doc}
                node={node}
                computed={computed}
                disabled={!settled || classDraft}
                save={save}
                draftChanged={setPresetDraft}
              />
            )}
            {ribbonGroup === 'Typography' && node.type === 'text' ? (
              <TextToolbar
                doc={doc}
                scope="Whole text"
                currentLink={textLink(node)}
                placeholders={computed}
                disabled={disabled}
                values={Object.fromEntries(
                  textProperties.map((property) => {
                    const value =
                      property in changes
                        ? changes[property]
                        : localValue(doc, node, property, breakpoint)
                    return [
                      property,
                      value
                        ? serializeValue(value, context)
                        : property in changes ||
                            property === 'font-size' ||
                            property === 'line-height'
                          ? ''
                          : (computed[property] ?? ''),
                    ]
                  }),
                )}
                change={(property, value) =>
                  changeFormatting(property, value ? { type: 'raw', value } : null)
                }
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
            ) : (
              <FormattingControls {...controls} groupName={ribbonGroup} ribbon />
            )}
            <div className="ribbon-reset">
              <button
                type="button"
                aria-label="Reset formatting"
                title="Reset local formatting"
                disabled={disabled || !settled || !overrides.length}
                onClick={resetFormatting}
              >
                <EditorIcon name="reset" />
                <span>Reset</span>
              </button>
            </div>
          </>,
          ribbonHost,
        )}
      <div className="selection-heading">
        <strong>{nodeLabel(node)}</strong>
        <span className="element-badge">{'tag' in node ? node.tag.toUpperCase() : node.type}</span>
      </div>
      <div className="inspector-section-name">Design</div>
      <div className="inspector-body">
        <div className="responsive-scope">
          <span>{doc.breakpoints[breakpoint]?.label ?? breakpoint}</span>
          <button
            type="button"
            className="scope-info-button"
            aria-label="About responsive editing"
            popoverTarget={scopeInfoId}
            onClick={(event) => placePopover(event.currentTarget, scopeInfo.current)}
          >
            <EditorIcon name="info" />
          </button>
          <div ref={scopeInfo} id={scopeInfoId} popover="auto" className="scope-info-popover">
            {breakpoint === 'base'
              ? `${overrides.length} local base styles. These apply to all sizes unless overridden.`
              : `${overrides.length} local overrides. Purple fields override this size; reset restores inheritance.`}{' '}
            Text and preset assignment apply to all sizes.
          </div>
        </div>
        {shared && <p className="note">Shared component. Changes appear in every instance.</p>}
        {locked && <p className="note">This element or its parent is locked.</p>}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void autosave.flush()
          }}
        >
          {isImage && (
            <div className="image-controls">
              <button
                type="button"
                disabled={disabled}
                aria-haspopup="dialog"
                onClick={() => setImageLibraryOpen(true)}
              >
                {imageAsset ? 'Change image' : 'Choose image'}
              </button>
              {imageLibraryOpen && (
                <ImageLibrary
                  siteId={siteId}
                  doc={doc}
                  selected={imageAsset}
                  close={() => setImageLibraryOpen(false)}
                  choose={(id) => {
                    setImageAsset(id)
                    setImageLibraryOpen(false)
                  }}
                />
              )}
              <label>
                Alt text
                <input
                  aria-label="Image alt text"
                  value={imageAlt}
                  disabled={disabled}
                  onChange={(event) => setImageAlt(event.target.value)}
                />
              </label>
              <p className="hint">Describe the image, or leave empty if it is decorative.</p>
              <label>
                Fit
                <select
                  aria-label="Image fit"
                  disabled={disabled}
                  value={
                    changes['object-fit']?.type === 'raw'
                      ? changes['object-fit'].value
                      : computed['object-fit'] || 'fill'
                  }
                  onChange={(event) =>
                    changeFormatting('object-fit', { type: 'raw', value: event.target.value })
                  }
                >
                  {Object.entries({
                    cover: 'Fill frame',
                    contain: 'Fit inside',
                    fill: 'Stretch',
                    none: 'Original size',
                    'scale-down': 'Shrink to fit',
                  }).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Focal point
                <select
                  aria-label="Image focal point"
                  disabled={disabled}
                  value={
                    changes['object-position']?.type === 'raw'
                      ? changes['object-position'].value
                      : computed['object-position'] || '50% 50%'
                  }
                  onChange={(event) =>
                    changeFormatting('object-position', { type: 'raw', value: event.target.value })
                  }
                >
                  {[
                    ['0% 0%', 'Top left'],
                    ['50% 0%', 'Top'],
                    ['100% 0%', 'Top right'],
                    ['0% 50%', 'Left'],
                    ['50% 50%', 'Center'],
                    ['100% 50%', 'Right'],
                    ['0% 100%', 'Bottom left'],
                    ['50% 100%', 'Bottom'],
                    ['100% 100%', 'Bottom right'],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
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
          ) : node.type === 'text' ? (
            <p className="note">
              {node.text.type === 'doc'
                ? 'Double-click this text on the canvas to edit words, formatting, and links.'
                : 'This text is bound to content and cannot be edited directly.'}
            </p>
          ) : null}
          <FormattingControls {...controls} groupName={ribbonGroup} />
          <ErrorNote message={validation} />
          <p className="hint" role="status">
            {conflict
              ? 'Changes paused. Reload to resolve the conflict.'
              : validation
                ? 'Waiting for a valid value.'
                : busy
                  ? 'Saving…'
                  : edits
                    ? 'Changes pending…'
                    : 'All changes saved'}
          </p>
          {autosave.hasFailed && !conflict && (
            <button type="button" onClick={autosave.retry}>
              Retry changes
            </button>
          )}
        </form>
        <details className="advanced-classes">
          <summary>Advanced: shared classes</summary>
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
        </details>
      </div>
    </aside>
  )
}
