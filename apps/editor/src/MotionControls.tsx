import { NumberField, type StyleControls, useStyleField } from './styleField.js'

export function MotionControls(props: StyleControls) {
  const { disabled, node } = props
  const { overridden, value: read, set } = useStyleField(props)
  const preview = (kind: string) =>
    window.dispatchEvent(
      new CustomEvent('freeflow:motion-preview', { detail: { id: node.id, kind } }),
    )
  return (
    <div className="motion-controls">
      <div className="motion-timing">
        {(['duration', 'delay'] as const).map((key) => (
          <NumberField
            key={key}
            label={key === 'duration' ? 'Duration (ms)' : 'Delay (ms)'}
            name={`Motion ${key}`}
            value={read(`--ff-${key}`, key === 'duration' ? '400ms' : '0ms')}
            unit="ms"
            min={0}
            max={10000}
            disabled={disabled}
            overridden={overridden(`--ff-${key}`)}
            // An emptied timing field means no time, not an unset property.
            set={(next) => set(`--ff-${key}`, next || '0ms')}
          />
        ))}
        <label>
          Easing
          <select
            aria-label="Motion easing"
            data-overridden={overridden('--ff-easing')}
            disabled={disabled}
            value={read('--ff-easing', 'ease-out')}
            onChange={(event) => set('--ff-easing', event.target.value)}
          >
            {['ease-out', 'ease-in-out', 'ease-in', 'ease', 'linear'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Entrance
          <select
            aria-label="Entrance animation"
            data-overridden={overridden('--ff-entrance')}
            disabled={disabled}
            value={read('--ff-entrance', 'none')}
            onChange={(event) => set('--ff-entrance', event.target.value)}
          >
            {Object.entries({
              none: 'None',
              'ff-fade': 'Fade in',
              'ff-slide-up': 'Slide up',
              'ff-slide-down': 'Slide down',
              'ff-slide-left': 'Slide left',
              'ff-slide-right': 'Slide right',
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || read('--ff-entrance', 'none') === 'none'}
          onClick={() => preview('entrance')}
        >
          Preview entrance
        </button>
      </div>
      <div className="motion-hover">
        {[
          { key: 'opacity', label: 'Hover opacity (%)', factor: 100, unit: '', min: 0, max: 100 },
          { key: 'scale', label: 'Hover scale (%)', factor: 100, unit: '', min: 0, max: 1000 },
          {
            key: 'rotate',
            label: 'Hover rotation (°)',
            factor: 1,
            unit: 'deg',
            min: -360,
            max: 360,
          },
        ].map(({ key, label, factor, unit, min, max }) => (
          <NumberField
            key={key}
            label={label}
            value={read(`--ff-hover-${key}`)}
            factor={factor}
            unit={unit}
            min={min}
            max={max}
            placeholder="Unchanged"
            disabled={disabled}
            overridden={overridden(`--ff-hover-${key}`)}
            set={(next) => set(`--ff-hover-${key}`, next)}
          />
        ))}
        <label>
          Hover shadow
          <select
            aria-label="Hover shadow"
            data-overridden={overridden('--ff-hover-box-shadow')}
            disabled={disabled}
            value={read('--ff-hover-box-shadow')}
            onChange={(event) => set('--ff-hover-box-shadow', event.target.value)}
          >
            <option value="">Unchanged</option>
            <option value="none">None</option>
            <option value="0px 4px 12px 0px #00000026">Soft</option>
            <option value="0px 12px 32px 0px #00000033">Elevated</option>
          </select>
        </label>
        <button type="button" disabled={disabled} onClick={() => preview('hover')}>
          Preview hover
        </button>
      </div>
      <p className="hint">
        Entrances play once on entering the viewport. Reduced-motion preferences are respected.
      </p>
    </div>
  )
}
