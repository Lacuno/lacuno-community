import { contextFromDocument, serializeValue } from '@lacuno/css'
import type { CssValue, Document } from '@lacuno/schema'
import { colorLabel, projectColors } from './colors.js'
import { TokenField } from './TokenField.js'

/** A colour: a project colour from the list, or a custom value with the token button. */
export function ColorField({
  doc,
  property,
  label,
  id,
  value,
  placeholder,
  disabled,
  set,
}: {
  doc: Document
  property: string
  label: string
  id: string
  value: CssValue | null | undefined
  placeholder: string
  disabled: boolean
  set: (value: CssValue | null) => void
}) {
  const ref = value?.type === 'designToken' ? value.ref : ''
  return (
    <>
      <label>
        {label}
        <select
          aria-label={`${label} source`}
          value={ref}
          disabled={disabled}
          onChange={(event) =>
            set(event.target.value ? { type: 'designToken', ref: event.target.value } : null)
          }
        >
          <option value="">Custom / inherited</option>
          {projectColors(doc).map((token) => (
            <option key={token.id} value={token.id}>
              {colorLabel(token.name)}
            </option>
          ))}
        </select>
      </label>
      {!ref && (
        <TokenField
          doc={doc}
          property={property}
          label={label}
          value={value}
          disabled={disabled}
          set={set}
        >
          <label htmlFor={id}>
            Custom color
            <input
              id={id}
              aria-label={label}
              disabled={disabled}
              placeholder={placeholder}
              value={value ? serializeValue(value, contextFromDocument(doc)) : ''}
              onChange={(event) =>
                set(event.target.value ? { type: 'color', value: event.target.value } : null)
              }
            />
          </label>
        </TokenField>
      )}
    </>
  )
}
