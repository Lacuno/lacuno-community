import { contextFromDocument, serializeValue } from '@lacuno/css'
import type { Operation } from '@lacuno/document'
import { nodesUsingClass, referencesToKeyframes } from '@lacuno/document/references'
import {
  type CssValue,
  type Document,
  type Keyframes,
  KeyframesId,
  type NodeId,
  StyleDecl,
} from '@lacuno/schema'
import { useState } from 'react'
import { Dialog, ErrorNote } from './Dialog.js'
import { nodeLabel } from './structure.js'

type Styles = Record<string, CssValue>

/**
 * A line of CSS declarations as a stop's styles, or undefined when a declaration is not one the
 * browser accepts. A value that reads as the saved one keeps its saved form, so a token stays one.
 */
function parseStyles(line: string, saved: Styles, doc: Document): Styles | undefined {
  const styles: Styles = {}
  for (const part of line.split(';')) {
    if (!part.trim()) continue
    const colon = part.indexOf(':')
    const property = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim()
    if (
      colon < 0 ||
      !StyleDecl.shape.property.safeParse(property).success ||
      !CSS.supports(property, value)
    )
      return undefined
    const kept = saved[property]
    styles[property] =
      kept && serializeValue(kept, contextFromDocument(doc)) === value
        ? kept
        : { type: 'raw', value }
  }
  return Object.keys(styles).length ? styles : undefined
}

/**
 * Creates or edits custom keyframes: a name, fixed once saved, and one line of CSS per stop. A bad
 * line or a repeated stop marks its field and keeps Save off. Delete also takes them off the
 * selected element, and is refused while anything else uses them.
 */
export function KeyframesDialog({
  doc,
  node,
  keyframes,
  disabled,
  save,
  created,
  close,
}: {
  doc: Document
  node: NodeId
  keyframes?: Keyframes | undefined
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
  created: (id: string) => void
  close: () => void
}) {
  const ctx = contextFromDocument(doc)
  const [name, setName] = useState(keyframes?.id ?? '')
  const [stops, setStops] = useState(
    keyframes?.stops.map((stop) => ({
      at: String(stop.at),
      line: Object.entries(stop.styles)
        .map(([property, value]) => `${property}: ${serializeValue(value, ctx)}`)
        .join('; '),
    })) ?? [{ at: '0', line: '' }],
  )
  const [status, setStatus] = useState('')
  const nameValid = keyframes || (KeyframesId.safeParse(name).success && !doc.keyframes[name])
  const ats = stops.map((stop) => (stop.at.trim() === '' ? Number.NaN : Number(stop.at)))
  const parsed = stops.map((stop, index) => {
    const at = ats[index]!
    const saved = keyframes?.stops.find((item) => item.at === at)?.styles ?? {}
    return {
      at,
      styles: parseStyles(stop.line, saved, doc),
      atValid: at >= 0 && at <= 100 && ats.indexOf(at) === ats.lastIndexOf(at),
    }
  })
  const valid = nameValid && parsed.every((stop) => stop.atValid && stop.styles)
  const change = (index: number, field: 'at' | 'line', value: string) =>
    setStops(stops.map((stop, i) => (i === index ? { ...stop, [field]: value } : stop)))
  return (
    <Dialog
      title={keyframes ? keyframes.id : 'New keyframes'}
      className="page-settings-dialog keyframes-dialog"
      closeLabel="×"
      closeName="Close"
      closeClassName="keyframes-close"
      disabled={disabled}
      close={close}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (!valid || disabled) return
          const operation = {
            type: keyframes ? ('keyframes.update' as const) : ('keyframes.create' as const),
            id: name,
            stops: parsed.map(({ at, styles }) => ({ at, styles: styles! })),
          }
          if (!(await save([operation]))) return
          if (!keyframes) created(name)
          close()
        }}
      >
        {!keyframes && (
          <label>
            Name
            <input
              autoComplete="off"
              value={name}
              placeholder="e.g. rise"
              aria-invalid={!!name && !nameValid}
              disabled={disabled}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        )}
        <div className="keyframes-stops">
          {stops.map((stop, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stops have no identity but their place
            <div className="keyframes-stop" key={index}>
              <label>
                At
                <input
                  type="number"
                  aria-label={`Stop ${index + 1} at`}
                  min={0}
                  max={100}
                  value={stop.at}
                  aria-invalid={!parsed[index]!.atValid}
                  disabled={disabled}
                  onChange={(event) => change(index, 'at', event.target.value)}
                />
                %
              </label>
              <input
                aria-label={`Stop ${index + 1} styles`}
                autoComplete="off"
                spellCheck={false}
                placeholder="opacity: 0; translate: 0 40px"
                value={stop.line}
                aria-invalid={!!stop.line.trim() && !parsed[index]!.styles}
                disabled={disabled}
                onChange={(event) => change(index, 'line', event.target.value)}
              />
              <button
                type="button"
                className="keyframes-close"
                aria-label={`Remove stop ${index + 1}`}
                disabled={disabled || stops.length === 1}
                onClick={() => setStops(stops.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="keyframes-add"
          disabled={disabled}
          onClick={() =>
            setStops([
              ...stops,
              { at: stops.some((stop) => stop.at === '100') ? '' : '100', line: '' },
            ])
          }
        >
          Add stop
        </button>
        <ErrorNote message={status} />
        <footer>
          {keyframes && (
            <button
              type="button"
              className="keyframes-delete"
              disabled={disabled}
              onClick={async () => {
                const uses = referencesToKeyframes(doc, keyframes.id).map(
                  (key) => doc.styles[key.replace('styles.', '')]!,
                )
                // Uses on a class only the selected element carries go with the keyframes.
                const own = (style: (typeof uses)[number]) =>
                  nodesUsingClass(doc, style.class).join() === node
                const users = uses
                  .filter((style) => !own(style))
                  .map(({ class: id }) => {
                    // A class by its name, an element's own style by the element.
                    const user = doc.nodes[nodesUsingClass(doc, id)[0] ?? '']
                    return doc.classes[id]?.name ?? (user ? nodeLabel(user) : 'an element')
                  })
                if (users.length)
                  setStatus(
                    `Used by ${[...new Set(users)].join(', ')}. Choose another animation there first.`,
                  )
                else if (
                  await save([
                    ...uses.map(({ value: _value, important: _important, ...style }) => ({
                      type: 'style.clear' as const,
                      ...style,
                    })),
                    { type: 'keyframes.delete', id: keyframes.id },
                  ])
                )
                  close()
              }}
            >
              Delete
            </button>
          )}
          <button type="button" disabled={disabled} onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={disabled || !valid}>
            Save
          </button>
        </footer>
      </form>
    </Dialog>
  )
}
