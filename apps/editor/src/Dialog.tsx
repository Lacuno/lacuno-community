import { type ReactNode, useEffect, useRef } from 'react'

/** A modal dialog with the editor's header: title, optional description and a close button. */
export function Dialog({
  title,
  label,
  description,
  className,
  closeLabel = 'Close',
  closeName,
  closeClassName,
  disabled = false,
  close,
  children,
}: {
  title: string
  label?: string
  description?: string
  className: string
  closeLabel?: string
  closeName?: string
  closeClassName?: string
  disabled?: boolean
  close: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
    dialog.current?.querySelector('input')?.focus()
  }, [])
  return (
    <dialog
      ref={dialog}
      className={className}
      aria-label={label ?? title}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault()
        if (!disabled) close()
      }}
    >
      <header>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <button
          type="button"
          className={closeClassName}
          aria-label={closeName}
          disabled={disabled}
          onClick={close}
        >
          {closeLabel}
        </button>
      </header>
      {children}
    </dialog>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return message ? (
    <p className="error" role="alert">
      {message}
    </p>
  ) : null
}
