import { contextFromDocument, serializeValue } from '@lacuno/css'
import type { ReactNode } from 'react'
import { ColorField } from './ColorField.js'
import { colorProperties } from './colors.js'
import { EffectsControls } from './EffectsControls.js'
import { fontChoices, weightName } from './fonts.js'
import { formattingGroups } from './formatting.js'
import { GradientControls } from './GradientControls.js'
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

/** Groups opened or closed by hand stay so for the next selection, like a remembered tab. */
const opened = new Map<string, boolean>()

export function FormattingControls({
  typography,
  words,
  ...controls
}: StyleControls & {
  typography?: ReactNode
  /** Rotating words, for a text element, shown above the Motion fields. */
  words?: ReactNode
}) {
  const { doc, node, change, disabled, computed } = controls
  const { local, overridden } = useStyleField(controls)
  return (
    <div className="formatting-controls inspector-formatting">
      {formattingGroups
        .filter((group) => node.type !== 'embed' || group.name !== 'Typography')
        // A tag rule styles many elements; entrances belong to the element around them.
        .filter((group) => !controls.read || group.name !== 'Motion')
        .toSorted((a, b) => {
          const order =
            node.type === 'text'
              ? ['Typography', 'Size', 'Spacing & shape', 'Layout', 'Colors', 'Effects', 'Motion']
              : ['Layout', 'Size', 'Spacing & shape', 'Typography', 'Colors', 'Effects', 'Motion']
          return order.indexOf(a.name) - order.indexOf(b.name)
        })
        .map((group) => {
          const open =
            opened.get(group.name) ??
            (group.name === 'Size' ||
              group.name === 'Spacing & shape' ||
              (node.type === 'text' ? group.name === 'Typography' : group.name === 'Layout'))
          return (
            <details
              data-group={group.name}
              key={group.name}
              open={open}
              // Mounting open fires toggle too; only a change by hand is remembered.
              onToggle={(event) => {
                if (event.currentTarget.open !== open)
                  opened.set(group.name, event.currentTarget.open)
              }}
            >
              <summary>{group.name}</summary>
              {group.name === 'Typography' && typography ? (
                typography
              ) : group.name === 'Motion' ? (
                <MotionControls {...controls}>{words}</MotionControls>
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
                      const text = value ? serializeValue(value, contextFromDocument(doc)) : ''
                      const color = colorProperties.has(property)
                      return (
                        <div
                          key={property}
                          data-property={property}
                          data-overridden={overridden(property)}
                          className={color || property === 'font-family' ? 'formatting-wide' : ''}
                        >
                          {color ? (
                            <ColorField
                              doc={doc}
                              property={property}
                              label={label}
                              id={`format-${property}`}
                              value={value}
                              placeholder={computed[property] || 'e.g. #6952d9'}
                              disabled={disabled}
                              set={(next) => change(property, next)}
                            />
                          ) : (
                            <TokenField
                              doc={doc}
                              property={property}
                              label={label}
                              value={value}
                              disabled={disabled}
                              set={(next) => change(property, next)}
                            >
                              <label htmlFor={`format-${property}`}>
                                {label}
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
                                      computed[property] || ('hint' in field ? field.hint : '')
                                    }
                                    value={text}
                                    onChange={(event) =>
                                      change(
                                        property,
                                        event.target.value
                                          ? { type: 'raw', value: event.target.value }
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
                  {group.name === 'Colors' && <GradientControls {...controls} />}
                </div>
              )}
            </details>
          )
        })}
    </div>
  )
}
