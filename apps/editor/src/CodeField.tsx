import { type ReactNode, useId, useRef } from 'react'
import { EditorIcon } from './EditorIcon.js'
import { placePopover } from './popover.js'

/** An info button with the popover it opens. */
export function InfoButton({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  const popover = useRef<HTMLDivElement>(null)
  return (
    <>
      <button
        type="button"
        className="scope-info-button"
        aria-label={label}
        popoverTarget={id}
        onClick={(event) => placePopover(event.currentTarget, popover.current)}
      >
        <EditorIcon name="info" />
      </button>
      <div ref={popover} id={id} popover="auto" className="scope-info-popover">
        {children}
      </div>
    </>
  )
}

/** A monospace code field with an info popover, like the embed field. */
export function CodeField({
  label,
  info,
  value,
  rows = 4,
  placeholder,
  disabled = false,
  change,
  commit,
}: {
  label: string
  info: ReactNode
  value: string
  rows?: number
  placeholder?: string
  disabled?: boolean
  change: (value: string) => void
  commit?: () => void
}) {
  return (
    <div className="embed-section">
      <div className="embed-heading">
        <span>{label}</span>
        <InfoButton label={`About ${label.toLowerCase()}`}>{info}</InfoButton>
      </div>
      <textarea
        aria-label={label}
        className="embed-code"
        rows={rows}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(event) => change(event.target.value)}
        onBlur={commit}
      />
    </div>
  )
}
