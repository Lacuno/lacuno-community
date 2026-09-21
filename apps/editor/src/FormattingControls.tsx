import { contextFromDocument, serializeValue } from '@freeflow/css'
import type { CssValue, Document, Node } from '@freeflow/schema'
import { colorLabel, colorProperties, projectColors } from './colors.js'
import { EffectsControls } from './EffectsControls.js'
import { formattingGroups, localValue } from './formatting.js'
import { MotionControls } from './MotionControls.js'

const choiceLabel = (value: string) =>
  (
    ({
      block: 'Normal flow',
      flex: 'Stack / row',
      grid: 'Grid',
      row: 'Horizontal',
      column: 'Vertical',
      nowrap: 'Single line',
      wrap: 'Wrap',
      'flex-start': 'Start',
      'flex-end': 'End',
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
  breakpoint = 'base',
  doc,
  node,
  changes,
  change,
  disabled,
  computed,
  groupName,
  ribbon = false,
}: {
  groupName?: string
  ribbon?: boolean
  computed: Record<string, string>
  breakpoint?: string
  doc: Document
  node: Node
  changes: Record<string, CssValue | null>
  change: (property: string, value: CssValue | null) => void
  disabled: boolean
}) {
  const controls = { breakpoint, doc, node, computed, changes, change, disabled }
  return (
    <div className={`formatting-controls ${ribbon ? 'ribbon-formatting' : 'inspector-formatting'}`}>
      {formattingGroups
        .filter((group) => {
          const active =
            group.name === groupName || (groupName === 'Spacing & shape' && group.name === 'Layout')
          return !groupName || (ribbon ? active : !active)
        })
        .map((group) => (
          <details
            data-group={group.name}
            key={group.name}
            open={
              ribbon ||
              (group.name !== 'Colors' && group.name !== 'Effects' && group.name !== 'Motion')
            }
          >
            <summary>{group.name}</summary>
            {group.name === 'Motion' ? (
              <MotionControls {...controls} />
            ) : group.name === 'Effects' ? (
              <EffectsControls {...controls} />
            ) : (
              <div className="formatting-grid">
                {group.fields
                  .filter(
                    (field) =>
                      field.property !== 'object-fit' && field.property !== 'object-position',
                  )
                  .map((field) => {
                    const { property, label } = field
                    const value =
                      property in changes
                        ? changes[property]
                        : localValue(doc, node, property, breakpoint)
                    const ref = value?.type === 'designToken' ? value.ref : ''
                    const text = value ? serializeValue(value, contextFromDocument(doc)) : ''
                    const color = colorProperties.has(property)
                    return (
                      <div
                        key={property}
                        data-property={property}
                        data-overridden={breakpoint !== 'base' && !!value}
                        title={
                          value
                            ? breakpoint === 'base'
                              ? 'Local base style'
                              : 'Local override at this breakpoint'
                            : 'Inherited from wider styles or the preset'
                        }
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
                                  {computed[property]
                                    ? choiceLabel(computed[property]!)
                                    : 'From style'}
                                </option>
                                {text && !(field.choices as readonly string[]).includes(text) && (
                                  <option value={text}>{text}</option>
                                )}
                                {field.choices.map((choice) => (
                                  <option key={choice} value={choice}>
                                    {choiceLabel(choice)}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                id={`format-${property}`}
                                aria-label={label}
                                disabled={disabled}
                                placeholder={
                                  computed[property] ||
                                  ('hint' in field ? field.hint : 'e.g. #6952d9')
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
            )}
          </details>
        ))}
    </div>
  )
}
