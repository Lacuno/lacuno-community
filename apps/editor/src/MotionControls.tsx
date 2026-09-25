import { NumberField, type StyleControls, useStyleField } from './styleField.js'

// The fields count milliseconds; a time set in seconds reads as its milliseconds.
const ms = (time: string) => (/\ds$/.test(time) ? `${Number.parseFloat(time) * 1000}ms` : time)

export function MotionControls(props: StyleControls) {
  const { disabled, node } = props
  const { overridden, value: read, set } = useStyleField(props)
  const preview = () =>
    window.dispatchEvent(new CustomEvent('lacuno:motion-preview', { detail: { id: node.id } }))
  return (
    <div className="motion-controls">
      <div className="motion-timing">
        {(['duration', 'delay'] as const).map((key) => (
          <NumberField
            key={key}
            label={key === 'duration' ? 'Duration (ms)' : 'Delay (ms)'}
            name={`Motion ${key}`}
            value={ms(read(`--lc-${key}`, key === 'duration' ? '400ms' : '0ms'))}
            unit="ms"
            min={0}
            max={10000}
            disabled={disabled}
            overridden={overridden(`--lc-${key}`)}
            // An emptied timing field means no time, not an unset property.
            set={(next) => set(`--lc-${key}`, next || '0ms')}
          />
        ))}
        <label>
          Easing
          <select
            aria-label="Motion easing"
            data-overridden={overridden('--lc-easing')}
            disabled={disabled}
            value={read('--lc-easing', 'ease-out')}
            onChange={(event) => set('--lc-easing', event.target.value)}
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
            data-overridden={overridden('--lc-entrance')}
            disabled={disabled}
            value={read('--lc-entrance', 'none')}
            onChange={(event) => set('--lc-entrance', event.target.value)}
          >
            {Object.entries({
              none: 'None',
              'lc-fade': 'Fade in',
              'lc-slide-up': 'Slide up',
              'lc-slide-down': 'Slide down',
              'lc-slide-left': 'Slide left',
              'lc-slide-right': 'Slide right',
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || read('--lc-entrance', 'none') === 'none'}
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
