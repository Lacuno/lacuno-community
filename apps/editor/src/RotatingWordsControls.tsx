import { iconSvg } from '@lacuno/css'
import type { Operation } from '@lacuno/document'
import {
  plainText,
  type RotatingWord,
  type RotatingWords,
  type TextNode,
  WordIcon,
} from '@lacuno/schema'
import { type KeyboardEvent, useId, useRef, useState } from 'react'
import { EditorIcon } from './EditorIcon.js'
import { placePopover } from './popover.js'

const wordText = (word: RotatingWord) => (typeof word === 'string' ? word : word.text)
const wordIcon = (word: RotatingWord) => (typeof word === 'string' ? undefined : word.icon)
const toWord = (text: string, icon: WordIcon | undefined): RotatingWord =>
  icon ? { text, icon } : text

/**
 * Words that take turns with the text's own, one row each: an icon and the word, kept as typed
 * (spaces count, empty is allowed), saved when a field is left or Enter is pressed.
 */
export function RotatingWordsControls({
  node,
  disabled,
  save,
}: {
  node: TextNode
  disabled: boolean
  save: (operations: Operation[]) => Promise<boolean>
}) {
  const current = node.rotatingWords
  const [intervalDraft, setIntervalDraft] = useState<string>()
  const update = (next: RotatingWords | null) =>
    void save([{ type: 'node.update', id: node.id, rotatingWords: next }])
  const setWords = (words: RotatingWord[]) => update(words.length ? { ...current, words } : null)
  const setWord = (index: number, word: RotatingWord) =>
    setWords((current?.words ?? []).map((old, i) => (i === index ? word : old)))
  const setOwnIcon = (icon: WordIcon | undefined) => {
    if (!current) return
    const { icon: _, ...rest } = current
    update(icon ? { ...rest, icon } : rest)
  }
  const commitInterval = () => {
    if (intervalDraft === undefined || !current) return
    setIntervalDraft(undefined)
    const { interval: _, ...rest } = current
    const ms = Math.round(Number(intervalDraft))
    if (ms !== current.interval)
      update(intervalDraft ? { ...rest, interval: Math.min(20000, Math.max(500, ms)) } : rest)
  }
  const enter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
  }
  const own =
    node.text.type === 'doc'
      ? plainText(node.text)
      : node.text.type === 'static'
        ? String(node.text.value)
        : 'Bound text'
  return (
    <div className="motion-timing">
      <fieldset className="motion-wide rotating-words">
        <legend>Rotating words</legend>
        {current && (
          <>
            <div className="rotating-word">
              <IconPicker
                label="Icon for the text"
                icon={current.icon}
                disabled={disabled}
                set={setOwnIcon}
              />
              <input aria-label="Text" value={own} disabled readOnly />
            </div>
            {current.words.map((word, index) => (
              // Words may repeat, so the position is part of the key; the text resets the field.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <div className="rotating-word" key={`${index}:${wordText(word)}`}>
                <IconPicker
                  label={`Icon for word ${index + 1}`}
                  icon={wordIcon(word)}
                  disabled={disabled}
                  set={(icon) => setWord(index, toWord(wordText(word), icon))}
                />
                <input
                  aria-label={`Word ${index + 1}`}
                  placeholder="Empty"
                  disabled={disabled}
                  defaultValue={wordText(word)}
                  onBlur={(event) => {
                    if (event.target.value !== wordText(word))
                      setWord(index, toWord(event.target.value, wordIcon(word)))
                  }}
                  onKeyDown={enter}
                />
                <button
                  type="button"
                  className="gradient-remove"
                  aria-label={`Remove word ${index + 1}`}
                  title="Remove word"
                  disabled={disabled}
                  onClick={() => setWords(current.words.filter((_, i) => i !== index))}
                >
                  <EditorIcon name="close" />
                </button>
              </div>
            ))}
          </>
        )}
        <button
          type="button"
          disabled={disabled || (current?.words.length ?? 0) >= 12}
          onClick={() => setWords([...(current?.words ?? []), ''])}
        >
          Add word
        </button>
      </fieldset>
      {current && (
        <>
          <label>
            Word interval (ms)
            <input
              aria-label="Word interval"
              type="number"
              min={500}
              max={20000}
              step={100}
              placeholder="2200"
              disabled={disabled}
              value={intervalDraft ?? current.interval ?? ''}
              onChange={(event) => setIntervalDraft(event.target.value)}
              onBlur={commitInterval}
              onKeyDown={(event) => event.key === 'Enter' && commitInterval()}
            />
          </label>
          <label>
            Word transition
            <select
              aria-label="Word transition"
              disabled={disabled}
              value={current.transition ?? 'slide'}
              onChange={(event) => {
                const { transition: _, ...rest } = current
                update(event.target.value === 'fade' ? { ...rest, transition: 'fade' } : rest)
              }}
            >
              <option value="slide">Slide up</option>
              <option value="fade">Fade</option>
            </select>
          </label>
        </>
      )}
    </div>
  )
}

/** A button showing a word's icon that opens the icon set, "None" first. */
function IconPicker({
  label,
  icon,
  disabled,
  set,
}: {
  label: string
  icon: WordIcon | undefined
  disabled: boolean
  set: (icon: WordIcon | undefined) => void
}) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  return (
    <>
      <button
        type="button"
        className="word-icon"
        aria-label={`${label}: ${icon ?? 'none'}`}
        title={label}
        disabled={disabled}
        popoverTarget={id}
        aria-haspopup="dialog"
        onClick={(event) => placePopover(event.currentTarget, panel.current)}
      >
        {icon ? <Icon icon={icon} /> : <span className="word-icon-none" />}
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="dialog"
        aria-label={label}
        className="word-icon-popover"
      >
        {[undefined, ...WordIcon.options].map((option) => (
          <button
            key={option ?? 'none'}
            type="button"
            className="word-icon"
            aria-label={option ?? 'No icon'}
            title={option ?? 'No icon'}
            aria-pressed={option === icon}
            onClick={() => {
              panel.current?.hidePopover()
              if (option !== icon) set(option)
            }}
          >
            {option ? <Icon icon={option} /> : <span className="word-icon-none" />}
          </button>
        ))}
      </div>
    </>
  )
}

/** The same SVG a published page carries, so the picker shows what the page will. */
function Icon({ icon }: { icon: WordIcon }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: fixed markup from the icon set
  return <span className="word-icon-glyph" dangerouslySetInnerHTML={{ __html: iconSvg(icon) }} />
}
