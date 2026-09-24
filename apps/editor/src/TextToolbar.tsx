import type { CssValue, Document } from '@miralo/schema'
import type { ReactNode } from 'react'
import { pickerHex } from './colors.js'
import { fontChoices } from './fonts.js'
import { LinkTarget, type LinkValue } from './LinkTarget.js'
import { TokenField } from './TokenField.js'
import './text-toolbar.css'

export function TextToolbar({
  doc,
  scope,
  values,
  placeholders = {},
  disabled,
  linkDisabled = false,
  currentLink,
  change,
  link,
  tokens,
  source,
  children,
}: {
  doc: Document
  scope: 'Whole text' | 'Selected text'
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
  /** The source line under a field; the inline selected-text editor has none. */
  source?: (property: string) => ReactNode
  children?: ReactNode
}) {
  const bold = Number(values['font-weight']) >= 600
  const italic = values['font-style'] === 'italic'
  const fonts = fontChoices(doc)
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
  const withSource = (property: string, field: ReactNode) =>
    source ? (
      <div
        className={`text-field ${['font-size', 'color'].includes(property) ? 'text-field-wide' : ''}`}
      >
        {field}
        {source(property)}
      </div>
    ) : (
      field
    )
  return (
    <section className="text-toolbar" aria-label="Text formatting">
      <div className="text-toolbar-fields">
        {withSource(
          'font-family',
          tokenField(
            'font-family',
            'Font',
            'text-font',
            <label className="text-font">
              Font
              <select
                aria-label="Font"
                disabled={disabled}
                value={values['font-family'] ?? ''}
                onChange={(event) => change('font-family', event.target.value)}
              >
                <option value="">Inherited</option>
                {values['font-family'] && !fonts.includes(values['font-family']) && (
                  <option>{values['font-family']}</option>
                )}
                {fonts.map((font) => (
                  <option key={font}>{font}</option>
                ))}
              </select>
            </label>,
          ),
        )}
        {withSource(
          'font-size',
          tokenField(
            'font-size',
            'Size',
            'text-size',
            <label className="text-size">
              Size
              <input
                aria-label="Size"
                disabled={disabled}
                value={values['font-size'] ?? ''}
                placeholder={placeholders['font-size'] || 'Inherited'}
                onChange={(event) => change('font-size', event.target.value)}
              />
            </label>,
          ),
        )}
        <button
          type="button"
          aria-label="Bold"
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
          aria-pressed={italic}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => change('font-style', italic ? 'normal' : 'italic')}
        >
          <em>I</em>
        </button>
        {withSource(
          'color',
          <label>
            Color
            <input
              type="color"
              aria-label="Text color"
              disabled={disabled}
              value={pickerHex(values.color ?? '', '#000000')}
              onChange={(event) => change('color', event.target.value)}
            />
          </label>,
        )}
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
        {withSource(
          'text-align',
          <label className="text-alignment" title="Applies to the whole text block">
            Alignment
            <select
              aria-label="Alignment"
              disabled={disabled}
              value={values['text-align'] ?? ''}
              onChange={(event) => change('text-align', event.target.value)}
            >
              <option value="">Inherited</option>
              {['start', 'left', 'center', 'right', 'justify'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>,
        )}
        {withSource(
          'line-height',
          tokenField(
            'line-height',
            'Line height',
            'text-line-height',
            <label className="text-line-height" title="Applies to the whole text block">
              Line height
              <input
                aria-label="Line height"
                disabled={disabled}
                value={values['line-height'] ?? ''}
                placeholder={placeholders['line-height'] || 'Inherited'}
                onChange={(event) => change('line-height', event.target.value)}
              />
            </label>,
          ),
        )}
      </div>
      <div className="text-toolbar-footer">
        <span className="text-scope">{scope}</span>
        <div className="text-edit-actions">{children}</div>
      </div>
    </section>
  )
}
