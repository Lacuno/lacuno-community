import { contextFromDocument, serializeValue } from '@freeflow/css'
import { useState } from 'react'
import { localValue } from './formatting.js'
import { NumberField, type StyleControls, useStyleField } from './styleField.js'

const sides = ['top', 'right', 'bottom', 'left'] as const
const sideLabel = { top: 'Top', right: 'Right', bottom: 'Bottom', left: 'Left' }

/** Four per-side inputs bound to the padding/margin longhands, linked when the sides are equal. */
function SpacingCluster({
  kind,
  label,
  min,
  ...props
}: StyleControls & { kind: 'padding' | 'margin'; label: string; min?: number }) {
  const { doc, node, computed, changes, breakpoint = 'base', state = 'none', disabled } = props
  const { overridden, set } = useStyleField(props)
  // The explicit local value only, so an inherited side stays empty and shows its computed placeholder.
  const local = (side: string) => {
    const property = `${kind}-${side}`
    const value =
      property in changes ? changes[property] : localValue(doc, node, property, breakpoint, state)
    return value ? serializeValue(value, contextFromDocument(doc)) : ''
  }
  const effective = (side: string) => local(side) || (computed[`${kind}-${side}`] ?? '')
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
          <NumberField
            key={side}
            label={sideLabel[side]}
            name={`${label} ${side}`}
            value={local(side)}
            min={min}
            placeholder={computed[`${kind}-${side}`]}
            disabled={disabled}
            overridden={overridden(`${kind}-${side}`)}
            set={(next) => {
              for (const target of linked ? sides : [side]) set(`${kind}-${target}`, next)
            }}
          />
        ))}
      </div>
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
