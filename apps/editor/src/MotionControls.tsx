import { isStory, MOTION_PRESETS, storySteps } from '@lacuno/css'
import type { Operation } from '@lacuno/document'
import { type ReactNode, useState } from 'react'
import { EditorIcon } from './EditorIcon.js'
import { KeyframesDialog } from './KeyframesDialog.js'
import { NumberField, type StyleControls, useStyleField } from './styleField.js'

// The fields count milliseconds; a time set in seconds reads as its milliseconds.
const ms = (time: string) => (/\ds$/.test(time) ? `${Number.parseFloat(time) * 1000}ms` : time)

// The Animation option that opens the keyframes dialog; a space is never in an animation name.
const NEW_KEYFRAMES = ' new'

export function MotionControls({
  children,
  save,
  ...props
}: StyleControls & {
  children?: ReactNode
  /** Saves custom keyframes from their dialog. */
  save: (operations: Operation[]) => Promise<boolean>
}) {
  const { disabled, node, doc, breakpoint = 'base', state = 'none' } = props
  // The keyframes the dialog edits, or '' for new ones; undefined while it is closed.
  const [editing, setEditing] = useState<string>()
  const { overridden, value: read, set } = useStyleField(props)
  // Off clears at the base; on a breakpoint or state it writes none over what applies there.
  const off = (property: string) => {
    if (breakpoint === 'base' && state === 'none') set(property, '')
    else if (read(property, 'none') !== 'none') set(property, 'none')
  }
  const follow = read('--lc-scroll', 'none') !== 'none'
  const name = follow ? read('--lc-scroll') : read('--lc-entrance', 'none')
  const preset = MOTION_PRESETS.find((item) => item.name === name)
  const choose = (next: string) => {
    const chosen = MOTION_PRESETS.find((item) => item.name === next)
    if (next === 'none') {
      for (const property of ['--lc-entrance', '--lc-scroll', '--lc-range', '--lc-timeline'])
        off(property)
      set('--lc-parallax', '')
      return
    }
    const scroll = chosen?.scroll || follow
    set(scroll ? '--lc-scroll' : '--lc-entrance', next)
    off(scroll ? '--lc-entrance' : '--lc-scroll')
    // A preset's own range replaces the one the previous preset brought; a chosen range stays.
    if (chosen?.range || preset?.range) set('--lc-range', chosen?.range ?? '')
    set('--lc-timeline', chosen?.timeline ?? '')
  }
  const trigger = (scroll: boolean) => {
    if (scroll === follow) return
    set(scroll ? '--lc-scroll' : '--lc-entrance', name)
    off(scroll ? '--lc-entrance' : '--lc-scroll')
  }
  let story = doc.nodes[node.parent ?? '']
  while (story && !isStory(story)) story = doc.nodes[story.parent ?? '']
  // Inside a story an element without a range follows the whole story, a step its own turn.
  const ranges: Record<string, string> = !story
    ? { entry: 'Entering', cover: 'Visible', exit: 'Leaving' }
    : node.parent === story.children[0]
      ? { '': 'In turn', contain: 'Whole story', entry: 'Entering' }
      : { '': 'Whole story', entry: 'Entering' }
  const range = read('--lc-range', story ? '' : 'entry')
  const custom = doc.keyframes[name]
  const options = (items: Record<string, string>) =>
    Object.entries(items).map(([option, text]) => (
      <option key={option} value={option}>
        {text}
      </option>
    ))
  const select = (
    label: string,
    marked: boolean,
    value: string,
    items: Record<string, string>,
    change: (value: string) => void,
    group?: Record<string, string>,
  ) => (
    <label>
      {label}
      <select
        aria-label={`Motion ${label.toLowerCase()}`}
        data-overridden={marked}
        disabled={disabled}
        value={value}
        onChange={(event) => change(event.target.value)}
      >
        {/* A value written through MCP shows as itself. */}
        {options(value in items || value in (group ?? {}) ? items : { ...items, [value]: value })}
        {group && <optgroup label="Custom keyframes">{options(group)}</optgroup>}
      </select>
    </label>
  )
  return (
    <div className="motion-controls">
      {children}
      <div className="motion-timing">
        <div className="motion-wide motion-animation">
          {select(
            'Animation',
            overridden('--lc-scroll') || overridden('--lc-entrance'),
            name,
            {
              none: 'None',
              ...Object.fromEntries(MOTION_PRESETS.map((item) => [item.name, item.label])),
            },
            (next) => (next === NEW_KEYFRAMES ? setEditing('') : choose(next)),
            {
              ...Object.fromEntries(Object.keys(doc.keyframes).map((id) => [id, id])),
              [NEW_KEYFRAMES]: 'New keyframes…',
            },
          )}
          {custom && (
            <button
              type="button"
              aria-label="Edit keyframes"
              title="Edit keyframes"
              disabled={disabled}
              onClick={() => setEditing(name)}
            >
              <EditorIcon name="pencil" />
            </button>
          )}
        </div>
        {name !== 'none' && (
          <fieldset className="motion-wide motion-trigger" aria-label="Motion trigger">
            {[false, true].map((scroll) => (
              <button
                type="button"
                key={String(scroll)}
                aria-pressed={follow === scroll}
                disabled={disabled || (!scroll && !!preset?.scroll)}
                onClick={() => trigger(scroll)}
              >
                {scroll ? 'Follow scroll' : 'On enter'}
              </button>
            ))}
          </fieldset>
        )}
        {follow ? (
          select('Range', overridden('--lc-range'), range, ranges, (next) =>
            set('--lc-range', next),
          )
        ) : (
          <>
            {(['duration', 'delay'] as const).map((key) => (
              <NumberField
                key={key}
                label={key === 'duration' ? 'Duration (ms)' : 'Delay (ms)'}
                name={`Motion ${key}`}
                value={ms(read(`--lc-${key}`, key === 'duration' ? '400ms' : '0ms'))}
                unit="ms"
                min={0}
                max={10000}
                disabled={disabled}
                overridden={overridden(`--lc-${key}`)}
                // An emptied timing field means no time, not an unset property.
                set={(next) => set(`--lc-${key}`, next || '0ms')}
              />
            ))}
            {select(
              'Easing',
              overridden('--lc-easing'),
              read('--lc-easing', 'ease-out'),
              Object.fromEntries(
                ['ease-out', 'ease-in-out', 'ease-in', 'ease', 'linear'].map((v) => [v, v]),
              ),
              (next) => set('--lc-easing', next),
            )}
          </>
        )}
        <button
          type="button"
          disabled={disabled || name === 'none'}
          onClick={() =>
            window.dispatchEvent(
              follow
                ? new CustomEvent('lacuno:canvas-preview')
                : new CustomEvent('lacuno:motion-preview', { detail: { id: node.id } }),
            )
          }
        >
          Preview
        </button>
        {isStory(node) && (
          <NumberField
            label="Length (screens)"
            name="Story length"
            value={read('--lc-length')}
            placeholder={String(storySteps(doc, node).length + 1)}
            min={1}
            max={50}
            disabled={disabled}
            overridden={overridden('--lc-length')}
            set={(next) => set('--lc-length', next)}
          />
        )}
      </div>
      {editing !== undefined && (
        <KeyframesDialog
          doc={doc}
          node={node.id}
          keyframes={doc.keyframes[editing]}
          disabled={disabled}
          save={save}
          created={choose}
          close={() => setEditing(undefined)}
        />
      )}
    </div>
  )
}
