import {
  Glossary,
  Locale,
  type Locale as LocaleType,
  primaryLocale,
  siteLocales,
  sourceHash,
  translationProblem,
  translationSource,
} from '@lacuno/schema'
import { z } from 'zod'
import type { PlanContext } from '../context.js'
import { defineOperation } from '../define.js'
import type { Patch } from '../patch.js'

const Code = Locale.shape.code

/** Replaces the site's languages, keeping `site.locale` on the primary for older readers. */
function setLocales(ctx: PlanContext, locales: LocaleType[]): Patch[] {
  const [primary] = locales
  if (primary!.draft) ctx.fail('the primary language cannot be a draft')
  if (primary!.tone || primary!.autoTranslate !== undefined)
    ctx.fail('the primary language takes no tone or auto-translate')
  return [
    { op: 'set', path: ['site', 'locales'], value: locales },
    { op: 'set', path: ['site', 'locale'], value: locales[0]!.code },
  ]
}

const localeIndex = (ctx: PlanContext, code: string): number =>
  ctx.indexOf(siteLocales(ctx.doc), (l) => l.code === code, `unknown language ${code}`, code)

const localeAdd = defineOperation(
  z.strictObject({ type: z.literal('locale.add'), ...Locale.shape }),
  (op, ctx) => {
    const { type: _type, ...locale } = op
    const locales = siteLocales(ctx.doc)
    if (locales.some((l) => l.code === op.code)) ctx.fail(`language ${op.code} already exists`)
    return setLocales(ctx, [...locales, locale])
  },
)

const localeUpdate = defineOperation(
  z.strictObject({
    type: z.literal('locale.update'),
    code: Code,
    label: Locale.shape.label.unwrap().nullable().optional(),
    draft: z.boolean().optional(),
    tone: Locale.shape.tone.unwrap().nullable().optional(),
    autoTranslate: z.boolean().optional(),
  }),
  (op, ctx) => {
    const locales = [...siteLocales(ctx.doc)]
    const index = localeIndex(ctx, op.code)
    const locale = { ...locales[index]! }
    if (op.label === null) delete locale.label
    else if (op.label !== undefined) locale.label = op.label
    if (op.draft) locale.draft = true
    else if (op.draft === false) delete locale.draft
    if (op.tone === null) delete locale.tone
    else if (op.tone !== undefined) locale.tone = op.tone
    if (op.autoTranslate) locale.autoTranslate = true
    else if (op.autoTranslate === false) delete locale.autoTranslate
    locales[index] = locale
    return setLocales(ctx, locales)
  },
)

const localeRemove = defineOperation(
  z.strictObject({ type: z.literal('locale.remove'), code: Code }),
  (op, ctx) => {
    const index = localeIndex(ctx, op.code)
    if (index === 0) ctx.fail(`${op.code} is the primary language and cannot be removed`)
    const locales = siteLocales(ctx.doc).filter((l) => l.code !== op.code)
    const patches = setLocales(ctx, locales)
    if (ctx.doc.translations[op.code])
      patches.push({ op: 'delete', path: ['translations', op.code] })
    return patches
  },
)

const localeReorder = defineOperation(
  z.strictObject({ type: z.literal('locale.reorder'), codes: z.array(Code).min(1) }),
  (op, ctx) => {
    const locales = siteLocales(ctx.doc)
    const same =
      op.codes.length === locales.length && locales.every((l) => op.codes.includes(l.code))
    if (!same) ctx.fail(`codes must list each language once: ${locales.map((l) => l.code)}`)
    return setLocales(
      ctx,
      op.codes.map((code) => locales.find((l) => l.code === code)!),
    )
  },
)

/** The language a translation is in: one of the site's, but not the primary. */
function requireOther(ctx: PlanContext, locale: string): void {
  localeIndex(ctx, locale)
  if (locale === primaryLocale(ctx.doc))
    ctx.fail(`${locale} is the primary language; change the value itself instead`)
}

const translationSet = defineOperation(
  z.strictObject({
    type: z.literal('translation.set'),
    locale: Code,
    key: z.string().min(1),
    value: z.unknown(),
  }),
  (op, ctx) => {
    requireOther(ctx, op.locale)
    const problem = translationProblem(ctx.doc, op.key, op.value)
    if (problem) ctx.fail(problem)
    const source = sourceHash(translationSource(ctx.doc, op.key)?.value)
    return [
      { op: 'set', path: ['translations', op.locale, op.key], value: { value: op.value, source } },
    ]
  },
)

const translationDelete = defineOperation(
  z.strictObject({ type: z.literal('translation.delete'), locale: Code, key: z.string().min(1) }),
  (op, ctx) => {
    requireOther(ctx, op.locale)
    if (!ctx.doc.translations[op.locale]?.[op.key])
      ctx.fail(`no ${op.locale} translation of ${op.key}`)
    return [{ op: 'delete', path: ['translations', op.locale, op.key] }]
  },
)

/** Replaces the site's glossary; an empty list removes it. */
const glossarySet = defineOperation(
  z.strictObject({ type: z.literal('glossary.set'), terms: Glossary }),
  (op, ctx): Patch[] =>
    op.terms.length
      ? [{ op: 'set', path: ['site', 'glossary'], value: op.terms }]
      : ctx.doc.site.glossary
        ? [{ op: 'delete', path: ['site', 'glossary'] }]
        : [],
)

export const translationOperations = [
  localeAdd,
  localeUpdate,
  localeRemove,
  localeReorder,
  translationSet,
  translationDelete,
  glossarySet,
]
