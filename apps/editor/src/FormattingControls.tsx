import { contextFromDocument, serializeValue } from '@lacuno/css'
import type { ReactNode } from 'react'
import { ColorField } from './ColorField.js'
import { colorProperties } from './colors.js'
import { EditorIcon } from './EditorIcon.js'
import { EffectsControls } from './EffectsControls.js'
import { fontChoices, weightName } from './fonts.js'
import { formattingGroups } from './formatting.js'
import { GradientControls } from './GradientControls.js'
import { LayoutControls } from './LayoutControls.js'
import { MediaStyleControls } from './MediaControls.js'
import { MotionControls } from './MotionControls.js'
import { isOpen, setOpen } from './openSections.js'
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
  typography,
  words,
  focused = false,
  ...controls
}: StyleControls & {
  typography?: ReactNode
  focused?: boolean
  /** Rotating words, for a text element, shown above the Motion fields. */
  words?: ReactNode
}) {
  const { doc, node, change, disabled, computed } = controls
  const { local, overridden } = useStyleField(controls)
  const value = (property: string) => {
    const own = local(property)
    return own ? serializeValue(own, contextFromDocument(doc)) : (computed[property] ?? '')
  }
  const summary = (name: string) => {
    if (name === 'Typography')
      return [value('font-family').split(',')[0]?.replaceAll('"', ''), value('font-size')]
        .filter(Boolean)
        .join(' · ')
    if (name === 'Layout')
      return value('display') === 'flex'
        ? value('flex-direction').startsWith('column')
          ? 'Stack'
          : 'Row'
        : value('display') === 'grid'
          ? 'Grid'
          : 'Flow'
    if (name === 'Size') return [value('width') || 'Auto', value('height') || 'Auto'].join(' × ')
    if (name === 'Spacing') {
      const padding = ['top', 'right', 'bottom', 'left'].map(
        (side) => value(`padding-${side}`) || '0px',
      )
      return new Set(padding).size === 1 ? padding[0] : 'Mixed'
    }
    return ''
  }
  type Group = (typeof formattingGroups)[number]
  const fields = (group: Group) =>
    group.name === 'Typography' && typography ? (
      typography
    ) : group.name === 'Layout' ? (
      <LayoutControls {...controls} />
    ) : group.name === 'Motion' ? (
      <MotionControls {...controls}>{words}</MotionControls>
    ) : group.name === 'Effects' ? (
      <EffectsControls {...controls} />
    ) : (
      <div className="formatting-grid">
        {group.name === 'Spacing' && <SpacingControls {...controls} />}
        {group.fields
          .filter((field) => field.property !== 'gap' && !/^(padding|margin)-/.test(field.property))
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
                          {text && !choices.includes(text) && <option value={text}>{text}</option>}
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
                          placeholder={computed[property] || ('hint' in field ? field.hint : '')}
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
        {group.name === 'Appearance' && <GradientControls {...controls} />}
      </div>
    )
  const renderGroup = (group: Group, nested = false): ReactNode => {
    const open = isOpen(
      group.name,
      focused && group.name === (node.type === 'text' ? 'Typography' : 'Layout'),
    )
    return (
      <details
        data-group={group.name}
        key={group.name}
        className={nested ? 'formatting-subsection' : undefined}
        open={open}
        // Mounting open fires toggle too; only a change by hand is remembered.
        onToggle={(event) => {
          if (event.currentTarget.open !== open) setOpen(group.name, event.currentTarget.open)
        }}
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: Native summary handles Enter/Space; remember the toggle before a scope remount. */}
        <summary
          onClick={(event) =>
            setOpen(group.name, !event.currentTarget.parentElement?.hasAttribute('open'))
          }
        >
          <span>{group.name}</span>
          {focused && (
            <>
              <span className="formatting-summary" aria-hidden="true">
                {summary(group.name)}
              </span>
              <EditorIcon name="chevron" />
            </>
          )}
        </summary>
        {focused &&
          group.name === 'Layout' &&
          renderGroup(formattingGroups.find((item) => item.name === 'Size')!, true)}
        {group.name === 'Layout' && node.type === 'element' && node.tag === 'img' && (
          <MediaStyleControls {...controls} />
        )}
        {fields(group)}
        {focused &&
          group.name === 'Appearance' &&
          renderGroup(formattingGroups.find((item) => item.name === 'Effects')!, true)}
      </details>
    )
  }
  const order =
    node.type === 'text'
      ? focused
        ? ['Typography', 'Layout', 'Spacing', 'Appearance', 'Motion']
        : ['Typography', 'Size', 'Spacing', 'Layout', 'Appearance', 'Effects', 'Motion']
      : ['Layout', 'Size', 'Spacing', 'Typography', 'Appearance', 'Effects', 'Motion']
  return (
    <div className="formatting-controls inspector-formatting">
      {formattingGroups
        .filter((group) => node.type !== 'embed' || group.name !== 'Typography')
        // A tag rule styles many elements; entrances belong to the element around them.
        .filter((group) => !controls.read || group.name !== 'Motion')
        .filter((group) => !focused || !['Size', 'Effects'].includes(group.name))
        .toSorted((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
        .map((group) => renderGroup(group))}
    </div>
  )
}
