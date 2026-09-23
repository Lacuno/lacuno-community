import { contextFromDocument, serializeValue } from '@freeflow/css'
import { useState } from 'react'
import { localValue } from './formatting.js'
import { sourceLabel, styleSource } from './presets.js'
import { SourceLine } from './SourceLine.js'
import { NumberField, type StyleControls, useStyleField } from './styleField.js'
import { TokenField } from './TokenField.js'

const sides = ['top', 'right', 'bottom', 'left'] as const
const sideLabel = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' }
// Tell the canvas which side's input has focus, so it shows the spacing boxes meanwhile.
const focusSide = (detail: { kind: 'padding' | 'margin'; side: string } | null) =>
  window.dispatchEvent(new CustomEvent('freeflow:spacing-focus', { detail }))

/** Four per-side inputs bound to the padding/margin longhands, linked when the sides are equal. */
function SpacingCluster({
  kind,
  label,
  min,
  ...props
}: StyleControls & { kind: 'padding' | 'margin'; label: string; min?: number }) {
  const {
    doc,
    node,
    computed,
    changes,
    change,
    breakpoint = 'base',
    state = 'none',
    disabled,
  } = props
  const { overridden, set } = useStyleField(props)
  // The explicit local value only, so an inherited side stays empty and shows its computed placeholder.
  const localCss = (side: string) => {
    const property = `${kind}-${side}`
    return property in changes
      ? changes[property]
      : localValue(doc, node, property, breakpoint, state)
  }
  const local = (side: string) => {
    const value = localCss(side)
    return value ? serializeValue(value, contextFromDocument(doc)) : ''
  }
  const effective = (side: string) => local(side) || (computed[`${kind}-${side}`] ?? '')
  // One source line for the group when the four sides agree, else one under each side.
  const agree =
    new Set(
      sides.map((side) =>
        sourceLabel(
          doc,
          styleSource(doc, node, `${kind}-${side}`, breakpoint, state, changes),
          breakpoint,
          state,
        ),
      ),
    ).size === 1
  const [linked, setLinked] = useState(sides.every((side) => effective(side) === effective('top')))
  return (
    <div className="spacing-cluster">
      <div className="spacing-head">
        <span>{label}</span>
        <label className="spacing-link">
          <input
            type="checkbox"
            aria-label={`Link ${label.toLowerCase()}`}
            checked={linked}
            disabled={disabled}
            onChange={(event) => setLinked(event.target.checked)}
          />
          Link
        </label>
      </div>
      <div className="spacing-sides">
        {sides.map((side) => (
          <div key={side}>
            <TokenField
              doc={doc}
              property={`${kind}-${side}`}
              label={sideLabel[side]}
              name={`${label} ${side}`}
              value={localCss(side)}
              disabled={disabled}
              set={(next) => {
                for (const target of linked ? sides : [side]) change(`${kind}-${target}`, next)
              }}
            >
              <NumberField
                label={sideLabel[side]}
                name={`${label} ${side}`}
                value={local(side)}
                min={min}
                placeholder={computed[`${kind}-${side}`]}
                disabled={disabled}
                overridden={overridden(`${kind}-${side}`)}
                onFocus={() => focusSide({ kind, side })}
                onBlur={() => focusSide(null)}
                set={(next) => {
                  for (const target of linked ? sides : [side]) set(`${kind}-${target}`, next)
                }}
              />
            </TokenField>
            {!agree && <SourceLine {...props} property={`${kind}-${side}`} />}
          </div>
        ))}
      </div>
      {agree && <SourceLine {...props} property={`${kind}-top`} />}
    </div>
  )
}

export function SpacingControls(props: StyleControls) {
  return (
    <div className="spacing-controls">
      <SpacingCluster {...props} kind="padding" label="Inside spacing" min={0} />
      <SpacingCluster {...props} kind="margin" label="Outside spacing" />
    </div>
  )
}
