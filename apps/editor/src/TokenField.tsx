import { contextFromDocument, serializeValue } from '@lacuno/css'
import type { CssValue, DesignToken, Document } from '@lacuno/schema'
import { type ReactNode, useId, useRef } from 'react'
import { EditorIcon } from './EditorIcon.js'
import { placePopover } from './popover.js'
import { groupOfProperty, tokenLabel, tokensForProperty, tokenValue } from './tokens.js'

/** A style input with a token button: pick a token of the property's group, or detach from it. */
export function TokenField({
  doc,
  property,
  label,
  name = label,
  value,
  disabled,
  set,
  className,
  children,
}: {
  doc: Document
  property: string
  label: string
  name?: string
  value: CssValue | null | undefined
  disabled: boolean
  set: (value: CssValue) => void
  className?: string
  children: ReactNode
}) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const group = groupOfProperty(property)
  const tokens = tokensForProperty(doc, property)
  const bound = value?.type === 'designToken' ? doc.designTokens[value.ref] : undefined
  if (!group || (!tokens.length && !bound)) return children
  const resolved = (token: DesignToken) =>
    serializeValue(tokenValue(doc, token), contextFromDocument(doc))
  const pick = (next: CssValue) => {
    set(next)
    panel.current?.hidePopover()
  }
  return (
    <div className={`token-field ${className ?? ''}`}>
      {bound ? (
        <label>
          {label}
          <input
            aria-label={name}
            readOnly
            disabled={disabled}
            value={tokenLabel(bound.name)}
            title={resolved(bound)}
            data-token={bound.name}
          />
        </label>
      ) : (
        children
      )}
      <button
        type="button"
        className="token-button"
        aria-label={`Use a token for ${name}`}
        title="Design tokens"
        disabled={disabled}
        popoverTarget={id}
        onClick={(event) => placePopover(event.currentTarget, panel.current)}
      >
        <EditorIcon name="token" />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        role="menu"
        aria-label={`${name} tokens`}
        className="token-popover"
      >
        {tokens.map((token) => (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={token.id === bound?.id}
            key={token.id}
            onClick={() => pick({ type: 'designToken', ref: token.id })}
          >
            <span>{tokenLabel(token.name)}</span>
            <small>{resolved(token)}</small>
          </button>
        ))}
        {bound && (
          <button type="button" role="menuitem" onClick={() => pick(tokenValue(doc, bound))}>
            Detach
          </button>
        )}
      </div>
    </div>
  )
}
