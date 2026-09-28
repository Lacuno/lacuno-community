import { type DateFormat, type Document, formatDate, type Node, pageLang } from '@lacuno/schema'
import { pageOf } from './structure.js'

const EXAMPLE = '2026-09-28'
const FORMATS: [DateFormat, string][] = [
  ['long', 'Long'],
  ['medium', 'Medium'],
  ['numeric', 'Numeric'],
]
const LOCALES = ['en-GB', 'en-US', 'de-DE', 'de-AT', 'de-CH', 'fr-FR', 'es-ES', 'it-IT', 'nl-NL']

/** The language dates read in where the node sits: its page's, else the site's. */
export function nodeLang(doc: Document, node: Node): string {
  const page = doc.pages[pageOf(doc, node.id)]
  return page ? pageLang(doc, page) : doc.site.locale
}

/**
 * How a bound date reads: a format shown with the example it gives, and once there is one, the
 * language it reads in, the page's unless another is chosen.
 */
export function DateFormatControls({
  format,
  locale,
  lang,
  disabled,
  change,
}: {
  format: DateFormat | undefined
  locale: string | undefined
  lang: string
  disabled: boolean
  change: (value: { format?: DateFormat; locale?: string }) => void
}) {
  const formats =
    FORMATS.some(([value]) => value === format) || !format
      ? FORMATS
      : [...FORMATS, [format, format === 'short' ? 'Short' : 'Full'] as [DateFormat, string]]
  const names = new Intl.DisplayNames([lang], { type: 'language' })
  return (
    <>
      <label>
        Date format
        <select
          aria-label="Date format"
          value={format ?? ''}
          disabled={disabled}
          onChange={(event) =>
            change({
              ...(event.target.value ? { format: event.target.value as DateFormat } : {}),
              ...(locale && event.target.value ? { locale } : {}),
            })
          }
        >
          <option value="">ISO · {EXAMPLE}</option>
          {formats.map(([value, name]) => (
            <option key={value} value={value}>
              {name} · {formatDate(EXAMPLE, value, locale ?? lang)}
            </option>
          ))}
        </select>
      </label>
      {format && (
        <label>
          Date language
          <select
            aria-label="Date language"
            value={locale ?? ''}
            disabled={disabled}
            onChange={(event) =>
              change({ format, ...(event.target.value ? { locale: event.target.value } : {}) })
            }
          >
            <option value="">Page language · {names.of(lang)}</option>
            {[...new Set([...LOCALES, ...(locale ? [locale] : [])])].map((value) => (
              <option key={value} value={value}>
                {names.of(value)}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )
}
