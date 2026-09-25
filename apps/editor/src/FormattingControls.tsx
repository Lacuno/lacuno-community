import { contextFromDocument, serializeValue } from '@lacuno/css'
import { colorLabel, colorProperties, projectColors } from './colors.js'
import { EffectsControls } from './EffectsControls.js'
import { fontChoices, weightName } from './fonts.js'
import { formattingGroups } from './formatting.js'
import { MotionControls } from './MotionControls.js'
import { SpacingControls } from './SpacingControls.js'
import { type StyleControls, useStyleField } from './styleField.js'
import { TokenField } from './TokenField.js'

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
      'system-ui, sans-serif': 'System sans-serif',
      'ui-monospace, monospace': 'Monospace',
    }) as Record<string, string>
  )[value] ??
  weightName(value)
    .split(',')[0]!
    .replaceAll('"', '')
    .replace(/^./, (letter) => letter.toUpperCase())

export function FormattingControls({
  groupName,
  ribbon = false,
  ...controls
}: StyleControls & {
  groupName?: string
  ribbon?: boolean
}) {
  const { doc, node, change, disabled, computed } = controls
  const { local, overridden } = useStyleField(controls)
  return (
    <div className={`formatting-controls ${ribbon ? 'ribbon-formatting' : 'inspector-formatting'}`}>
      {formattingGroups
        .filter((group) => {
          if (node.type === 'embed' && group.name === 'Typography') return false
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
                {group.name === 'Spacing & shape' && <SpacingControls {...controls} />}
                {group.fields
                  .filter(
                    (field) =>
                      field.property !== 'object-fit' &&
                      field.property !== 'object-position' &&
                      !/^(padding|margin)-/.test(field.property),
                  )
                  .map((field) => {
                    const { property, label } = field
                    const choices: readonly string[] =
                      property === 'font-family'
                        ? fontChoices(doc)
                        : 'choices' in field
                          ? field.choices
                          : []
                    const value = local(property)
                    const ref = value?.type === 'designToken' ? value.ref : ''
                    const text = value ? serializeValue(value, contextFromDocument(doc)) : ''
                    const color = colorProperties.has(property)
                    return (
                      <div
                        key={property}
                        data-property={property}
                        data-overridden={overridden(property)}
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
                          <TokenField
                            doc={doc}
                            property={property}
                            label={label}
                            value={value}
                            disabled={disabled}
                            set={(next) => change(property, next)}
                          >
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
                                      ? `From style · ${choiceLabel(computed[property]!)}`
                                      : 'From style'}
                                  </option>
                                  {text && !choices.includes(text) && (
                                    <option value={text}>{text}</option>
                                  )}
                                  {choices.map((choice) => (
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
                                        ? {
                                            type: color ? 'color' : 'raw',
                                            value: event.target.value,
                                          }
                                        : null,
                                    )
                                  }
                                />
                              )}
                            </label>
                          </TokenField>
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
