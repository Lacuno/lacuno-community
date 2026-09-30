import { contextFromDocument, serializeValue } from '@lacuno/css'
import { useId, useState } from 'react'
import { EditorIcon } from './EditorIcon.js'
import {
  containerLayoutProperties,
  gridTemplate,
  gridTracks,
  itemSize,
  itemSizeChanges,
  type LayoutMode,
  layoutChanges,
  layoutMode,
} from './layout.js'
import { presetValues } from './presets.js'
import { type StyleControls, useStyleField } from './styleField.js'
import { TokenField } from './TokenField.js'
import './layout-controls.css'

const modes = [
  { value: 'block', label: 'Flow', icon: 'layer' },
  { value: 'row', label: 'Row', icon: 'row' },
  { value: 'stack', label: 'Stack', icon: 'stack' },
  { value: 'grid', label: 'Grid', icon: 'grid' },
] as const
const recipes = [
  { label: 'Two equal columns', weights: [1, 1], caption: '1 : 1' },
  { label: 'Narrow left column', weights: [1, 2], caption: '1 : 2' },
  { label: 'Wide left column', weights: [2, 1], caption: '2 : 1' },
  { label: 'Three equal columns', weights: [1, 1, 1], caption: '1 : 1 : 1' },
]
const positions = ['start', 'center', 'end'] as const

export function LayoutControls(controls: StyleControls) {
  const { doc, disabled, change, parent } = controls
  const { value, local, overridden, set } = useStyleField(controls)
  const id = useId()
  const [track, setTrack] = useState(0)
  const mode = layoutMode(value('display', 'block'), value('flex-direction', 'row'))
  const grid = mode === 'grid'
  const flex = mode === 'row' || mode === 'stack'
  const template = value('grid-template-columns')
  const tracks = gridTracks(template)
  const selectedTrack = Math.min(track, (tracks?.length ?? 1) - 1)
  const apply = (changes: Record<string, string>) => {
    for (const [property, text] of Object.entries(changes)) set(property, text)
  }
  const chooseMode = (next: LayoutMode) => apply(layoutChanges(next, template))
  const field = (property: string, label: string, fallback = '') => (
    <div data-property={property} data-overridden={overridden(property)}>
      <TokenField
        doc={doc}
        property={property}
        label={label}
        value={local(property)}
        disabled={disabled}
        set={(next) => change(property, next)}
      >
        <label htmlFor={`${id}-${property}`}>
          {label}
          <input
            id={`${id}-${property}`}
            aria-label={label}
            disabled={disabled}
            value={
              local(property) ? serializeValue(local(property)!, contextFromDocument(doc)) : ''
            }
            placeholder={value(property, fallback)}
            onChange={(event) => set(property, event.target.value)}
          />
        </label>
      </TokenField>
    </div>
  )
  const select = (
    property: string,
    label: string,
    options: readonly string[],
    fallback: string,
  ) => (
    <label data-overridden={overridden(property)}>
      {label}
      <select
        aria-label={label}
        disabled={disabled}
        value={value(property, fallback)}
        onChange={(event) => set(property, event.target.value)}
      >
        {!options.includes(value(property, fallback)) && (
          <option value={value(property, fallback)}>{value(property, fallback)}</option>
        )}
        {options.map((option) => (
          <option key={option} value={option}>
            {option === '1 / -1'
              ? 'Full width'
              : option === 'auto'
                ? 'Automatic'
                : option.replaceAll('-', ' ').replace(/^./, (c) => c.toUpperCase())}
          </option>
        ))}
      </select>
    </label>
  )
  const inherited = presetValues(doc, controls.node, {}, controls.breakpoint, controls.state)
  const authored = (property: string, fallback = '') => {
    const item = property in controls.changes ? controls.changes[property] : inherited[property]
    return item ? serializeValue(item, contextFromDocument(doc)) : fallback
  }
  const parentFlex = parent?.display.includes('flex')
  const parentGrid = parent?.display.includes('grid')
  const horizontal = !!parentFlex && !parent!.direction.startsWith('column')
  const selfAlign = value(parentGrid ? 'justify-self' : 'align-self', 'auto')
  const parentAlign = controls.computed[parentGrid ? '__parent-justify' : '__parent-align']
  const effectiveAlign = selfAlign === 'auto' ? parentAlign : selfAlign
  const sizing = itemSize(
    authored('width'),
    value('flex-grow', '0'),
    horizontal,
    !horizontal && (effectiveAlign === 'normal' || effectiveAlign === 'stretch'),
  )
  const align =
    value('align-items', 'stretch') === 'normal' ? 'stretch' : value('align-items', 'stretch')
  const justify = value(grid ? 'justify-items' : 'justify-content', grid ? 'stretch' : 'flex-start')
  const reverse = value('flex-direction').endsWith('reverse')
  const normal = (v: string) => v.replace('flex-', '')
  const main =
    reverse && !grid
      ? normal(justify) === 'start'
        ? 'end'
        : normal(justify) === 'end'
          ? 'start'
          : normal(justify)
      : normal(justify)
  const xValue = mode === 'stack' ? normal(align) : main
  const yValue = mode === 'stack' ? main : normal(align)
  const aligned = (x: string, y: string) => xValue === x && yValue === y
  const hasOwnLayout = containerLayoutProperties.some((property) => !!local(property))
  return (
    <div className="layout-controls">
      <fieldset
        className="layout-mode-picker"
        aria-label="Layout type"
        data-overridden={overridden('display') || overridden('flex-direction')}
      >
        {modes.map((item) => (
          <button
            type="button"
            key={item.value}
            aria-label={`${item.label} layout`}
            aria-pressed={mode === item.value}
            disabled={disabled}
            onClick={() => chooseMode(item.value)}
          >
            <span className={`layout-mode-art layout-mode-${item.value}`} aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>{item.label}</span>
          </button>
        ))}
      </fieldset>
      {!mode && (
        <p className="layout-note">
          Custom display: {value('display')}. Choose a layout to change it.
        </p>
      )}
      {mode === 'block' && <p className="layout-note">Content follows the natural page flow.</p>}
      {grid && (
        <>
          <div className="layout-section-heading">
            <span>Columns</span>
            <span className="layout-stepper">
              <button
                type="button"
                aria-label="Remove column"
                disabled={disabled || !tracks || tracks.length <= 1}
                onClick={() => {
                  set('grid-template-columns', gridTemplate(tracks!.slice(0, -1)))
                }}
              >
                −
              </button>
              <input
                type="number"
                aria-label="Column count"
                min="1"
                max="12"
                disabled={disabled}
                value={tracks?.length ?? ''}
                placeholder="—"
                onChange={(event) => {
                  const count = Number(event.target.value)
                  if (Number.isInteger(count) && count >= 1 && count <= 12)
                    set(
                      'grid-template-columns',
                      gridTemplate(Array.from({ length: count }, (_, i) => tracks?.[i] ?? 1)),
                    )
                }}
              />
              <button
                type="button"
                aria-label="Add column"
                disabled={disabled || !tracks || tracks.length >= 12}
                onClick={() => set('grid-template-columns', gridTemplate([...tracks!, 1]))}
              >
                <EditorIcon name="plus" />
              </button>
            </span>
          </div>
          <fieldset className="layout-recipes" aria-label="Column arrangements">
            {recipes.map((recipe) => (
              <button
                type="button"
                key={recipe.label}
                aria-label={recipe.label}
                title={recipe.label}
                aria-pressed={JSON.stringify(tracks) === JSON.stringify(recipe.weights)}
                disabled={disabled}
                onClick={() => set('grid-template-columns', gridTemplate(recipe.weights))}
              >
                <span
                  aria-hidden="true"
                  style={{ gridTemplateColumns: recipe.weights.map((n) => `${n}fr`).join(' ') }}
                >
                  {recipe.weights.map((_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static decorative tracks have positional identities.
                    <i key={i} />
                  ))}
                </span>
                <small>{recipe.caption}</small>
              </button>
            ))}
          </fieldset>
          {tracks ? (
            <div
              className="layout-track-editor"
              data-overridden={overridden('grid-template-columns')}
            >
              <fieldset
                className="layout-track-preview"
                aria-label="Grid tracks"
                style={{ gridTemplateColumns: tracks.map((n) => `${n}fr`).join(' ') }}
              >
                {tracks.map((weight, index) => (
                  <button
                    type="button"
                    // biome-ignore lint/suspicious/noArrayIndexKey: a track is identified by its column position.
                    key={index}
                    aria-label={`Select column ${index + 1}`}
                    aria-pressed={selectedTrack === index}
                    disabled={disabled}
                    onClick={() => setTrack(index)}
                  >
                    <span>{index + 1}</span>
                    <small>{weight}fr</small>
                  </button>
                ))}
              </fieldset>
              <label className="layout-track-size">
                <span>Column {selectedTrack + 1}</span>
                <span>
                  <input
                    type="number"
                    aria-label={`Column ${selectedTrack + 1} fraction`}
                    min="0.1"
                    max="100"
                    step="0.1"
                    value={tracks[selectedTrack]}
                    disabled={disabled}
                    onChange={(event) => {
                      const n = Number(event.target.value)
                      if (n > 0 && n <= 100)
                        set(
                          'grid-template-columns',
                          gridTemplate(tracks.map((w, i) => (i === selectedTrack ? n : w))),
                        )
                    }}
                  />
                  <small>fr</small>
                </span>
              </label>
            </div>
          ) : (
            <p className="layout-note">
              Custom grid preserved. Choose an arrangement or edit its CSS below.
            </p>
          )}
        </>
      )}
      {(grid || flex) && (
        <>
          <div className="layout-arrange">
            <div>
              <span className="layout-field-title">Alignment</span>
              <fieldset
                className="layout-alignment"
                aria-label="Item alignment"
                data-overridden={
                  overridden('align-items') ||
                  overridden(grid ? 'justify-items' : 'justify-content')
                }
              >
                {positions.flatMap((y, yi) =>
                  positions.map((x, xi) => (
                    <button
                      type="button"
                      key={`${x}-${y}`}
                      aria-label={`Align ${['left', 'center', 'right'][xi]} ${['top', 'middle', 'bottom'][yi]}`}
                      aria-pressed={aligned(x, y)}
                      disabled={disabled}
                      onClick={() => {
                        let main = mode === 'stack' ? y : x
                        if (reverse && !grid)
                          main = main === 'start' ? 'end' : main === 'end' ? 'start' : main
                        apply(
                          grid
                            ? { 'justify-items': x, 'align-items': y }
                            : {
                                'justify-content': main === 'center' ? main : `flex-${main}`,
                                'align-items':
                                  (mode === 'stack' ? x : y) === 'center'
                                    ? 'center'
                                    : `flex-${mode === 'stack' ? x : y}`,
                              },
                        )
                      }}
                    >
                      <i />
                    </button>
                  )),
                )}
              </fieldset>
            </div>
            <div className="layout-arrange-options">
              {flex && (
                <button
                  type="button"
                  className="layout-option"
                  aria-label="Wrap items"
                  aria-pressed={value('flex-wrap', 'nowrap') !== 'nowrap'}
                  disabled={disabled}
                  onClick={() =>
                    set('flex-wrap', value('flex-wrap', 'nowrap') === 'nowrap' ? 'wrap' : 'nowrap')
                  }
                >
                  <EditorIcon name="wrap" />
                  <span>Wrap</span>
                  <i />
                </button>
              )}
              <button
                type="button"
                className="layout-option"
                aria-label="Stretch items"
                aria-pressed={align === 'stretch'}
                disabled={disabled}
                onClick={() => set('align-items', align === 'stretch' ? 'flex-start' : 'stretch')}
              >
                <EditorIcon name="stretch" />
                <span>Stretch</span>
                <i />
              </button>
              {flex && (
                <button
                  type="button"
                  className="layout-option"
                  aria-label="Space between items"
                  aria-pressed={justify === 'space-between'}
                  disabled={disabled}
                  onClick={() =>
                    set(
                      'justify-content',
                      justify === 'space-between' ? 'flex-start' : 'space-between',
                    )
                  }
                >
                  <EditorIcon name="distribute" />
                  <span>Space between</span>
                  <i />
                </button>
              )}
            </div>
          </div>
          <div className="layout-gap-fields">
            {field('column-gap', 'Horizontal gap', '0px')}
            {field('row-gap', 'Vertical gap', '0px')}
          </div>
        </>
      )}
      {(parentFlex || parentGrid) && (
        <div className="layout-item">
          <button
            type="button"
            className="layout-parent"
            onClick={parent!.select}
            title="Edit parent layout"
          >
            <EditorIcon name="up" />
            <span>
              Inside <strong>{parent!.label}</strong>
            </span>
            <small>{parentGrid ? 'Grid' : horizontal ? 'Row' : 'Stack'}</small>
          </button>
          <div className="layout-field-title">Item width</div>
          <fieldset className="layout-sizing" aria-label="Item width">
            {(['fit', 'fill', 'fixed'] as const).map((option) => (
              <button
                type="button"
                key={option}
                aria-label={`Width: ${option === 'fit' ? 'Fit content' : option === 'fill' ? 'Fill space' : 'Fixed'}`}
                aria-pressed={sizing === option}
                disabled={disabled}
                onClick={() =>
                  apply(itemSizeChanges(option, horizontal, controls.computed.width ?? '160px'))
                }
              >
                <EditorIcon
                  name={option === 'fit' ? 'fit' : option === 'fill' ? 'stretch' : 'fixed'}
                />
                {option === 'fit' ? 'Fit' : option === 'fill' ? 'Fill' : 'Fixed'}
              </button>
            ))}
          </fieldset>
          {sizing === 'fixed' && field('width', 'Item width value', '160px')}
          {parentGrid && (
            <div className="layout-gap-fields">
              {select(
                'grid-column',
                'Column span',
                ['auto', 'span 2', 'span 3', 'span 4', '1 / -1'],
                'auto',
              )}
              {select('grid-row', 'Row span', ['auto', 'span 2', 'span 3', 'span 4'], 'auto')}
            </div>
          )}
        </div>
      )}
      <details className="layout-advanced">
        <summary>Advanced layout</summary>
        <div className="layout-advanced-fields">
          {select(
            'display',
            'Layout type',
            ['block', 'flex', 'grid', 'inline', 'inline-flex', 'inline-grid', 'none'],
            'block',
          )}
          {flex && (
            <>
              {select(
                'flex-direction',
                'Direction',
                ['row', 'column', 'row-reverse', 'column-reverse'],
                'row',
              )}
              {select(
                'justify-content',
                'Distribute items',
                [
                  'flex-start',
                  'center',
                  'flex-end',
                  'space-between',
                  'space-around',
                  'space-evenly',
                ],
                'flex-start',
              )}
              {select(
                'align-items',
                'Align items',
                ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'],
                'stretch',
              )}
            </>
          )}
          {grid && (
            <>
              {field('grid-template-columns', 'Grid columns')}
              {field('grid-template-rows', 'Grid rows', 'auto')}
              {select(
                'grid-auto-flow',
                'Grid flow',
                ['row', 'column', 'row dense', 'column dense'],
                'row',
              )}
              {select(
                'justify-items',
                'Align in cell',
                ['stretch', 'start', 'center', 'end'],
                'stretch',
              )}
            </>
          )}
          {(flex || grid) && field('gap', 'Item spacing', '0px')}
          {(parentFlex || parentGrid) && (
            <>
              {select(
                'align-self',
                'Item alignment',
                ['auto', 'stretch', 'flex-start', 'center', 'flex-end'],
                'auto',
              )}
              {field('order', 'Display order', '0')}
            </>
          )}
        </div>
      </details>
      {hasOwnLayout && (
        <button
          type="button"
          className="layout-reset"
          disabled={disabled}
          onClick={() => {
            for (const property of containerLayoutProperties)
              if (local(property)) change(property, null)
          }}
        >
          <EditorIcon name="reset" />
          Reset layout at this size
        </button>
      )}
    </div>
  )
}
