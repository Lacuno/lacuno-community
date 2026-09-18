import { contextFromDocument, serializeValue } from '@freeflow/css'
import type { CssValue, Document, Node } from '@freeflow/schema'
import { colorLabel, colorProperties, projectColors } from './colors.js'
import { formattingGroups, localValue } from './formatting.js'

const choiceLabel = (value: string) =>
  (
    ({
      '400': 'Regular',
      '500': 'Medium',
      '600': 'Semibold',
      '700': 'Bold',
      '800': 'Extra bold',
    }) as Record<string, string>
  )[value] ??
  value
    .split(',')[0]!
    .replaceAll('"', '')
    .replace(/^./, (letter) => letter.toUpperCase())

export function FormattingControls({
  doc,
  node,
  changes,
  change,
  disabled,
  computed,
}: {
  computed: Record<string, string>
  doc: Document
  node: Node
  changes: Record<string, CssValue | null>
  change: (property: string, value: CssValue | null) => void
  disabled: boolean
}) {
  return (
    <div className="formatting-controls">
      <p className="hint">
        Formatting applies to this element. Empty fields use the existing style.
      </p>
      {formattingGroups.map((group) => (
        <details key={group.name} open={group.name === 'Typography'}>
          <summary>{group.name}</summary>
          <div className="formatting-grid">
            {group.fields.map((field) => {
              const { property, label } = field
              const value =
                property in changes ? changes[property] : localValue(doc, node, property)
              const ref = value?.type === 'designToken' ? value.ref : ''
              const text = value ? serializeValue(value, contextFromDocument(doc)) : ''
              const color = colorProperties.has(property)
              return (
                <div
                  key={property}
                  className={color || property === 'font-family' ? 'formatting-wide' : ''}
                >
                  {color && (
                    <label>
                      {label}
                      <select
                        aria-label={`${label} source`}
                        value={ref}
                        disabled={disabled}
                        onChange={(event) =>
                          change(
                            property,
                            event.target.value
                              ? { type: 'designToken', ref: event.target.value }
                              : null,
                          )
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
                  )}
                  {(!color || !ref) && (
                    <label htmlFor={`format-${property}`}>
                      {color ? 'Custom color' : label}
                      {'choices' in field ? (
                        <select
                          id={`format-${property}`}
                          aria-label={label}
                          disabled={disabled}
                          value={text}
                          onChange={(event) =>
                            change(
                              property,
                              event.target.value
                                ? { type: 'raw', value: event.target.value }
                                : null,
                            )
                          }
                        >
                          <option value="">
                            {computed[property] ? choiceLabel(computed[property]!) : 'From style'}
                          </option>
                          {text && !(field.choices as readonly string[]).includes(text) && (
                            <option value={text}>{text}</option>
                          )}
                          {field.choices.map((choice) => (
                            <option key={choice} value={choice}>
                              {(
                                {
                                  'Inter, sans-serif': 'Inter',
                                  'Arial, sans-serif': 'Arial',
                                  'Georgia, serif': 'Georgia',
                                  monospace: 'Monospace',
                                  '400': 'Regular',
                                  '500': 'Medium',
                                  '600': 'Semibold',
                                  '700': 'Bold',
                                  '800': 'Extra bold',
                                } as Record<string, string>
                              )[choice] ?? choice}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={`format-${property}`}
                          aria-label={label}
                          disabled={disabled}
                          placeholder={
                            computed[property] || ('hint' in field ? field.hint : 'e.g. #6952d9')
                          }
                          value={text}
                          onChange={(event) =>
                            change(
                              property,
                              event.target.value
                                ? { type: color ? 'color' : 'raw', value: event.target.value }
                                : null,
                            )
                          }
                        />
                      )}
                    </label>
                  )}
                </div>
              )
            })}
          </div>
        </details>
      ))}
    </div>
  )
}
