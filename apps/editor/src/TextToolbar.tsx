import type { CssValue, Document } from '@lacuno/schema'
import type { ReactNode } from 'react'
import { pickerHex } from './colors.js'
import { fontChoices, weightName } from './fonts.js'
import { LinkTarget, type LinkValue } from './LinkTarget.js'
import { TokenField } from './TokenField.js'
import './text-toolbar.css'

export function TextToolbar({
  doc,
  scope,
  compact = false,
  values,
  placeholders = {},
  disabled,
  linkDisabled = false,
  currentLink,
  change,
  link,
  tokens,
  overridden,
  children,
}: {
  doc: Document
  scope?: 'Whole text' | 'Selected text'
  /** The inspector's Typography group: placeholders name only the inherited value, no footer. */
  compact?: boolean
  values: Record<string, string>
  placeholders?: Record<string, string>
  disabled: boolean
  linkDisabled?: boolean
  currentLink?: Record<string, unknown> | undefined
  change: (property: string, value: string) => void
  link: (attrs: LinkValue | null) => void
  /** The whole-text style values as typed values, so typography fields can bind to tokens. */
  tokens?: {
    value: (property: string) => CssValue | null | undefined
    set: (property: string, value: CssValue) => void
  }
  overridden?: (property: string) => boolean
  children?: ReactNode
}) {
  const bold = Number(values['font-weight'] || placeholders['font-weight']) >= 600
  const italic = (values['font-style'] || placeholders['font-style']) === 'italic'
  const fonts = fontChoices(doc)
  // Without a value of its own a field shows what it inherits; the canvas value is then that.
  const inherited = (property: string, name = (value: string) => value) =>
    values[property] || !placeholders[property]
      ? 'Inherited'
      : compact
        ? name(placeholders[property]).split(',')[0]!.replaceAll('"', '')
        : `Inherited · ${name(placeholders[property])}`
  const tokenField = (property: string, label: string, className: string, field: ReactNode) =>
    tokens ? (
      <TokenField
        doc={doc}
        property={property}
        label={label}
        className={className}
        value={tokens.value(property)}
        disabled={disabled}
        set={(value) => tokens.set(property, value)}
      >
        {field}
      </TokenField>
    ) : (
      field
    )
  return (
    <section className="text-toolbar" aria-label="Text formatting">
      <div className="text-toolbar-fields">
        {tokenField(
          'font-family',
          'Font',
          'text-font',
          <label className="text-font">
            Font
            <select
              aria-label="Font"
              data-overridden={overridden?.('font-family')}
              disabled={disabled}
              value={values['font-family'] ?? ''}
              onChange={(event) => change('font-family', event.target.value)}
            >
              <option value="">{inherited('font-family')}</option>
              {values['font-family'] && !fonts.includes(values['font-family']) && (
                <option>{values['font-family']}</option>
              )}
              {fonts.map((font) => (
                <option key={font}>{font}</option>
              ))}
            </select>
          </label>,
        )}
        {tokenField(
          'font-size',
          'Size',
          'text-size',
          <label className="text-size">
            Size
            <input
              aria-label="Size"
              data-overridden={overridden?.('font-size')}
              disabled={disabled}
              value={values['font-size'] ?? ''}
              placeholder={placeholders['font-size'] || 'Inherited'}
              onChange={(event) => change('font-size', event.target.value)}
            />
          </label>,
        )}
        {tokenField(
          'font-weight',
          'Weight',
          'text-weight',
          <label className="text-weight">
            Weight
            <select
              aria-label="Weight"
              data-overridden={overridden?.('font-weight')}
              disabled={disabled}
              value={values['font-weight'] ?? ''}
              onChange={(event) => change('font-weight', event.target.value)}
            >
              <option value="">{inherited('font-weight', weightName)}</option>
              {values['font-weight'] &&
                !['400', '500', '600', '700', '800'].includes(values['font-weight']) && (
                  <option value={values['font-weight']}>{values['font-weight']}</option>
                )}
              {['400', '500', '600', '700', '800'].map((value) => (
                <option key={value} value={value}>
                  {weightName(value)}
                </option>
              ))}
            </select>
          </label>,
        )}
        <button
          type="button"
          aria-label="Bold"
          data-overridden={overridden?.('font-weight')}
          aria-pressed={bold}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => change('font-weight', bold ? '400' : '700')}
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          aria-label="Italic"
          data-overridden={overridden?.('font-style')}
          aria-pressed={italic}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => change('font-style', italic ? 'normal' : 'italic')}
        >
          <em>I</em>
        </button>
        <label>
          Color
          <input
            type="color"
            aria-label="Text color"
            data-overridden={overridden?.('color')}
            disabled={disabled}
            value={pickerHex(values.color || placeholders.color || '', '#000000')}
            onChange={(event) => change('color', event.target.value)}
          />
        </label>
        <LinkTarget
          doc={doc}
          label="Link"
          disabled={disabled || linkDisabled}
          current={{
            pageId: typeof currentLink?.pageId === 'string' ? currentLink.pageId : undefined,
            href: typeof currentLink?.href === 'string' ? currentLink.href : undefined,
          }}
          apply={link}
          remove={() => link(null)}
        />
        <label className="text-alignment" title="Applies to the whole text block">
          Alignment
          <select
            aria-label="Alignment"
            data-overridden={overridden?.('text-align')}
            disabled={disabled}
            value={values['text-align'] ?? ''}
            onChange={(event) => change('text-align', event.target.value)}
          >
            <option value="">{inherited('text-align')}</option>
            {['start', 'left', 'center', 'right', 'justify'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {tokenField(
          'line-height',
          'Line height',
          'text-line-height',
          <label className="text-line-height" title="Applies to the whole text block">
            Line height
            <input
              aria-label="Line height"
              data-overridden={overridden?.('line-height')}
              disabled={disabled}
              value={values['line-height'] ?? ''}
              placeholder={placeholders['line-height'] || 'Inherited'}
              onChange={(event) => change('line-height', event.target.value)}
            />
          </label>,
        )}
      </div>
      {!compact && (
        <div className="text-toolbar-footer">
          <span className="text-scope">{scope}</span>
          <div className="text-edit-actions">{children}</div>
        </div>
      )}
    </section>
  )
}
