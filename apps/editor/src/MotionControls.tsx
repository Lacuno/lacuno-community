import { NumberField, type StyleControls, useStyleField } from './styleField.js'

export function MotionControls(props: StyleControls) {
  const { disabled, node } = props
  const { overridden, value: read, set } = useStyleField(props)
  const preview = () =>
    window.dispatchEvent(new CustomEvent('freeflow:motion-preview', { detail: { id: node.id } }))
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
          onClick={preview}
        >
          Preview entrance
        </button>
      </div>
      <p className="hint">
        Entrances play once on entering the viewport. Timing applies to state changes too, such as a
        hover you set with the state picker. Reduced-motion preferences are respected.
      </p>
    </div>
  )
}
