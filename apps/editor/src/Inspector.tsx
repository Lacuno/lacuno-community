import { classNames, contextFromDocument, selectorFor, serializeValue } from '@freeflow/css'
import type { Operation } from '@freeflow/document'
import type { CssValue, Document, Node } from '@freeflow/schema'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { assetUrl } from './AssetsPanel.js'
import { breakpointMedia } from './breakpoints.js'
import { ClassManager } from './ClassManager.js'
import { EditorIcon } from './EditorIcon.js'
import { FormattingControls } from './FormattingControls.js'
import { formattingOperations, localClass, localValue, normalizeFormatting } from './formatting.js'
import { ImageLibrary } from './ImageLibrary.js'
import type { LivePreview } from './livePreview.js'
import { PresetManager } from './PresetManager.js'
import { TextToolbar } from './TextToolbar.js'
import { hasAnchorParent } from './textAncestors.js'
import { textLink, textProperties, wholeText } from './textFormatting.js'
import { useAutosave } from './useAutosave.js'

const describe = (node: Node) => node.meta?.label ?? ('tag' in node ? node.tag : node.type)

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
  registerFlush: (flush: () => Promise<boolean>) => void
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
    ([property, value]) =>
      value &&
      value.type !== 'designToken' &&
      !CSS.supports(property, serializeValue(value, contextFromDocument(doc))),
  )
  const validation = invalid
    ? `Enter a valid value for ${invalid[0]}, such as 24px or #334155.`
    : ''
  const textDirty = originalText !== undefined && text !== originalText
  const styleDirty = Object.keys(pending).length > 0
  useEffect(() => {
    dirtyChanged(textDirty || styleDirty || imageDirty || classDraft || presetDraft)
  }, [textDirty, styleDirty, imageDirty, classDraft, presetDraft, dirtyChanged])
  let locked = false
  let shared = false
  for (
    let current: Node | undefined = node;
    current;
    current = current.parent ? doc.nodes[current.parent] : undefined
  ) {
    if (current.meta?.locked) locked = true
    if (Object.values(doc.components).some((component) => component.root === current?.id))
      shared = true
  }
  const disabled = conflict || locked || classDraft || presetDraft
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
  const autosave = useAutosave(operations, !disabled && !invalid, busy, autoSave)
  const flushRef = useRef(autosave.flush)
  flushRef.current = async () => !invalid && !classDraft && !presetDraft && (await autosave.flush())
  useEffect(() => {
    registerFlush(() => flushRef.current())
    return () => registerFlush(async () => true)
  }, [registerFlush])
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
        Object.entries(normalized)
          .filter(
            ([property, value]) =>
              value === null ||
              CSS.supports(property, serializeValue(value, contextFromDocument(doc))),
          )
          .map(([property, value]) => [
            property,
            value === null ? null : serializeValue(value!, contextFromDocument(doc)),
          ]),
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
                disabled={
                  busy || conflict || locked || textDirty || styleDirty || imageDirty || classDraft
                }
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
                        ? serializeValue(value, contextFromDocument(doc))
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
                  busy ||
                  styleDirty ||
                  textDirty ||
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
                disabled={
                  disabled || busy || !overrides.length || textDirty || styleDirty || imageDirty
                }
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
        <strong>
          {node.type === 'text' && 'tag' in node && /^h[1-6]$/.test(node.tag)
            ? 'Heading'
            : describe(node)}
        </strong>
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
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              if (scopeInfo.current) {
                scopeInfo.current.style.left = `${Math.max(12, Math.min(rect.right - 260, innerWidth - 272))}px`
                scopeInfo.current.style.top = `${Math.max(12, Math.min(rect.bottom + 8, innerHeight - 150))}px`
              }
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="7.5" />
              <path d="M10 9v5" />
              <circle cx="10" cy="6" r=".8" fill="currentColor" stroke="none" />
            </svg>
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
          {validation && (
            <p className="error" role="alert">
              {validation}
            </p>
          )}
          <p className="hint" role="status">
            {conflict
              ? 'Changes paused. Reload to resolve the conflict.'
              : validation
                ? 'Waiting for a valid value.'
                : busy
                  ? 'Saving…'
                  : textDirty || styleDirty || imageDirty
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
            disabled={
              busy || conflict || locked || textDirty || styleDirty || imageDirty || presetDraft
            }
            save={save}
            draftChanged={setClassDraft}
          />
        </details>
      </div>
    </aside>
  )
}
