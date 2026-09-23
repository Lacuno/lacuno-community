import { contextFromDocument, serializeValue } from '@freeflow/css'
import { useState } from 'react'
import { EditorIcon } from './EditorIcon.js'
import { localValue } from './formatting.js'
import { sourceLabel, styleSource } from './presets.js'
import { SourceLine } from './SourceLine.js'
import { NumberField, type StyleControls, useStyleField } from './styleField.js'
import { TokenField } from './TokenField.js'

const pairs = [
  ['top', 'bottom'],
  ['left', 'right'],
] as const
type Side = (typeof pairs)[number][number]
// Tell the canvas which side's input has focus, so it shows the spacing boxes meanwhile.
const focusSide = (detail: { kind: 'padding' | 'margin'; side: string } | null) =>
  window.dispatchEvent(new CustomEvent('freeflow:spacing-focus', { detail }))

// The visible labels name the kind and side ("Inside top"); the accessible names spell it out.
type ClusterProps = StyleControls & {
  kind: 'padding' | 'margin'
  prefix: 'Inside' | 'Outside'
  min?: number
}

/** Two opposite sides bound to their longhands, with a chain that edits both at once. It starts
 * linked when the sides are equal, like the canvas handles moving opposite sides together. */
function SpacingPair({
  kind,
  prefix,
  min,
  pair,
  ...props
}: ClusterProps & { pair: (typeof pairs)[number] }) {
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
  // The text the side's source line shows.
  const source = (side: string) => {
    const property = `${kind}-${side}`
    const origin = styleSource(doc, node, property, breakpoint, state, changes)
    return sourceLabel(doc, origin, breakpoint, state, computed[property], property).text
  }
  const [linked, setLinked] = useState(effective(pair[0]) === effective(pair[1]))
  const targets = (side: Side) => (linked ? pair : [side])
  const field = (side: Side) => (
    <TokenField
      doc={doc}
      property={`${kind}-${side}`}
      label={`${prefix} ${side}`}
      name={`${prefix} spacing ${side}`}
      value={localCss(side)}
      disabled={disabled}
      set={(next) => {
        for (const target of targets(side)) change(`${kind}-${target}`, next)
      }}
    >
      <NumberField
        label={`${prefix} ${side}`}
        name={`${prefix} spacing ${side}`}
        value={local(side)}
        min={min}
        placeholder={computed[`${kind}-${side}`]}
        disabled={disabled}
        overridden={overridden(`${kind}-${side}`)}
        onFocus={() => focusSide({ kind, side })}
        onBlur={() => focusSide(null)}
        set={(next) => {
          for (const target of targets(side)) set(`${kind}-${target}`, next)
        }}
      />
    </TokenField>
  )
  return (
    <div className="spacing-pair">
      {field(pair[0])}
      <button
        type="button"
        className="spacing-chain"
        aria-pressed={linked}
        aria-label={`Link ${prefix.toLowerCase()} spacing ${pair[0]} and ${pair[1]}`}
        title="Link both sides"
        disabled={disabled}
        onClick={() => setLinked(!linked)}
      >
        <EditorIcon name="link" />
      </button>
      {field(pair[1])}
      {/* One source line for the pair when both sides agree, else one under each side. */}
      <SourceLine {...props} property={`${kind}-${pair[0]}`} />
      {source(pair[0]) !== source(pair[1]) && (
        <SourceLine {...props} property={`${kind}-${pair[1]}`} />
      )}
    </div>
  )
}

function SpacingCluster(props: ClusterProps) {
  return (
    <div className="spacing-cluster">
      {pairs.map((pair) => (
        <SpacingPair key={pair[0]} {...props} pair={pair} />
      ))}
    </div>
  )
}

export function SpacingControls(props: StyleControls) {
  return (
    <div className="spacing-controls">
      <SpacingCluster {...props} kind="padding" prefix="Inside" min={0} />
      <SpacingCluster {...props} kind="margin" prefix="Outside" />
    </div>
  )
}
