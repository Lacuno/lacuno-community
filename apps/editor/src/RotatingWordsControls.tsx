import type { Operation } from '@lacuno/document'
import type { RotatingWords, TextNode } from '@lacuno/schema'
import { type KeyboardEvent, useState } from 'react'

/** Words that take turns with the text's own, saved when a field is left or Enter is pressed. */
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
  const [wordsDraft, setWordsDraft] = useState<string>()
  const [intervalDraft, setIntervalDraft] = useState<string>()
  const update = (next: RotatingWords | null) =>
    void save([{ type: 'node.update', id: node.id, rotatingWords: next }])
  const commitWords = () => {
    if (wordsDraft === undefined) return
    setWordsDraft(undefined)
    const list = wordsDraft
      .split(',')
      .map((word) => word.trim())
      .filter(Boolean)
    if (list.join() !== current?.words.join())
      update(list.length ? { ...current, words: list } : null)
  }
  const commitInterval = () => {
    if (intervalDraft === undefined || !current) return
    setIntervalDraft(undefined)
    const { interval: _, ...rest } = current
    const ms = Math.round(Number(intervalDraft))
    if (ms !== current.interval)
      update(intervalDraft ? { ...rest, interval: Math.min(20000, Math.max(500, ms)) } : rest)
  }
  const enter = (commit: () => void) => (event: KeyboardEvent) => {
    if (event.key === 'Enter') commit()
  }
  return (
    <div className="motion-timing">
      <label className="motion-wide">
        Rotating words
        <input
          aria-label="Rotating words"
          placeholder="e.g. designer, you"
          disabled={disabled}
          value={wordsDraft ?? current?.words.join(', ') ?? ''}
          onChange={(event) => setWordsDraft(event.target.value)}
          onBlur={commitWords}
          onKeyDown={enter(commitWords)}
        />
      </label>
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
              onKeyDown={enter(commitInterval)}
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
