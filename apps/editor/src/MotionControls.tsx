import { NumberField, type StyleControls, useStyleField } from './styleField.js'

// The fields count milliseconds; a time set in seconds reads as its milliseconds.
const ms = (time: string) => (/\ds$/.test(time) ? `${Number.parseFloat(time) * 1000}ms` : time)

export function MotionControls(props: StyleControls) {
  const { disabled, node } = props
  const { overridden, value: read, set } = useStyleField(props)
  const preview = () =>
    window.dispatchEvent(new CustomEvent('miralo:motion-preview', { detail: { id: node.id } }))
  return (
    <div className="motion-controls">
      <div className="motion-timing">
        {(['duration', 'delay'] as const).map((key) => (
          <NumberField
            key={key}
            label={key === 'duration' ? 'Duration (ms)' : 'Delay (ms)'}
            name={`Motion ${key}`}
            value={ms(read(`--mi-${key}`, key === 'duration' ? '400ms' : '0ms'))}
            unit="ms"
            min={0}
            max={10000}
            disabled={disabled}
            overridden={overridden(`--mi-${key}`)}
            // An emptied timing field means no time, not an unset property.
            set={(next) => set(`--mi-${key}`, next || '0ms')}
          />
        ))}
        <label>
          Easing
          <select
            aria-label="Motion easing"
            data-overridden={overridden('--mi-easing')}
            disabled={disabled}
            value={read('--mi-easing', 'ease-out')}
            onChange={(event) => set('--mi-easing', event.target.value)}
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
            data-overridden={overridden('--mi-entrance')}
            disabled={disabled}
            value={read('--mi-entrance', 'none')}
            onChange={(event) => set('--mi-entrance', event.target.value)}
          >
            {Object.entries({
              none: 'None',
              'mi-fade': 'Fade in',
              'mi-slide-up': 'Slide up',
              'mi-slide-down': 'Slide down',
              'mi-slide-left': 'Slide left',
              'mi-slide-right': 'Slide right',
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || read('--mi-entrance', 'none') === 'none'}
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
