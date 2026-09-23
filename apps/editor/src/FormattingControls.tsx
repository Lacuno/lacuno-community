import { contextFromDocument, serializeValue } from '@freeflow/css'
import type { CssValue, Document, Node, State } from '@freeflow/schema'
import { colorLabel, colorProperties, projectColors } from './colors.js'
import { EffectsControls } from './EffectsControls.js'
import { fontChoices } from './fonts.js'
import { formattingGroups, localValue } from './formatting.js'
import { MotionControls } from './MotionControls.js'
import { SourceLine } from './SourceLine.js'
import { SpacingControls } from './SpacingControls.js'
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
      '400': 'Regular',
      '500': 'Medium',
      '600': 'Semibold',
      '700': 'Bold',
      '800': 'Extra bold',
      'system-ui, sans-serif': 'System sans-serif',
      'ui-monospace, monospace': 'Monospace',
    }) as Record<string, string>
  )[value] ??
  value
    .split(',')[0]!
    .replaceAll('"', '')
    .replace(/^./, (letter) => letter.toUpperCase())

export function FormattingControls({
  breakpoint = 'base',
  state = 'none',
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
  state?: State
  doc: Document
  node: Node
  changes: Record<string, CssValue | null>
  change: (property: string, value: CssValue | null) => void
  disabled: boolean
}) {
  const controls = { breakpoint, state, doc, node, computed, changes, change, disabled }
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
                {group.name === 'Spacing & shape' && (
                  <SpacingControls key={`${node.id}-${breakpoint}-${state}`} {...controls} />
                )}
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
                    const value =
                      property in changes
                        ? changes[property]
                        : localValue(doc, node, property, breakpoint, state)
                    const ref = value?.type === 'designToken' ? value.ref : ''
                    const text = value ? serializeValue(value, contextFromDocument(doc)) : ''
                    const color = colorProperties.has(property)
                    return (
                      <div
                        key={property}
                        data-property={property}
                        data-overridden={(breakpoint !== 'base' || state !== 'none') && !!value}
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
                        <SourceLine {...controls} property={property} />
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
