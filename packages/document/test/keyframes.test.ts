import { fixtureDocument } from '@lacuno/schema'
import { describe, expect, it } from 'vitest'
import { planBatch } from '../src/engine.js'
import { OperationError } from '../src/errors.js'
import { OPERATIONS_BY_TYPE, type Operation } from '../src/operations/index.js'

const run = (ops: Operation[], doc = fixtureDocument()) => planBatch(doc, ops, OPERATIONS_BY_TYPE)
const failing = (ops: Operation[], pattern: RegExp, doc = fixtureDocument()) => {
  try {
    planBatch(doc, ops, OPERATIONS_BY_TYPE)
    expect.unreachable()
  } catch (e) {
    expect(e).toBeInstanceOf(OperationError)
    expect((e as OperationError).message).toMatch(pattern)
    return e as OperationError
  }
}

const raw = (value: string) => ({ type: 'raw' as const, value })
const pop: Operation = {
  type: 'keyframes.create',
  id: 'pop',
  stops: [
    { at: 60, styles: { scale: raw('1.05') } },
    { at: 0, styles: { opacity: raw('0'), scale: raw('.8') } },
  ],
}
const entrance = (value: string, property = '--lc-entrance'): Operation => ({
  type: 'style.set',
  class: 'c-heading',
  breakpoint: 'base',
  state: 'none',
  property,
  value: raw(value),
})

describe('keyframes', () => {
  it('creates with sorted stops, updates and deletes', () => {
    const { document } = run([pop])
    expect(document.keyframes.pop).toEqual({
      id: 'pop',
      stops: [
        { at: 0, styles: { opacity: raw('0'), scale: raw('.8') } },
        { at: 60, styles: { scale: raw('1.05') } },
      ],
    })
    const updated = run(
      [{ type: 'keyframes.update', id: 'pop', stops: [{ at: 0, styles: { opacity: raw('0') } }] }],
      document,
    ).document
    expect(updated.keyframes.pop!.stops).toEqual([{ at: 0, styles: { opacity: raw('0') } }])
    expect(run([{ type: 'keyframes.delete', id: 'pop' }], updated).document.keyframes).toEqual({})
    failing([{ type: 'keyframes.delete', id: 'pop' }], /unknown keyframes pop/)
    failing([pop, pop], /keyframes pop already exists/)
  })

  it('refuses preset names, none, repeated stops and unknown tokens', () => {
    for (const id of ['lc-pop', 'none', 'inherit', 'Pop', '1pop'])
      failing([{ ...pop, id } as Operation], /invalid input: id/)
    failing(
      [
        {
          type: 'keyframes.create',
          id: 'twice',
          stops: [
            { at: 0, styles: {} },
            { at: 0, styles: { opacity: raw('0') } },
          ],
        },
      ],
      /two stops at 0%/,
    )
    failing(
      [
        {
          type: 'keyframes.create',
          id: 'tinted',
          stops: [{ at: 0, styles: { color: { type: 'designToken', ref: 't-missing' } } }],
        },
      ],
      /unknown design token t-missing/,
    )
  })

  it('refuses deleting keyframes a style names, and a token they use', () => {
    const { document } = run([
      {
        type: 'keyframes.create',
        id: 'tint',
        stops: [{ at: 0, styles: { color: { type: 'designToken', ref: 't-brand' } } }],
      },
      entrance('tint', '--lc-scroll'),
    ])
    const error = failing(
      [{ type: 'keyframes.delete', id: 'tint' }],
      /tint is referenced/,
      document,
    )
    expect(error.referencedBy).toEqual(['styles.c-heading|base|none|--lc-scroll'])
    const token = failing(
      [{ type: 'designToken.delete', id: 't-brand' }],
      /t-brand is referenced/,
      document,
    )
    expect(token.referencedBy).toContain('keyframes.tint')
  })

  it('warns when an entrance or scroll animation names neither a preset nor keyframes', () => {
    expect(run([entrance('lc-fade'), entrance('none')]).warnings).toEqual([])
    expect(run([pop, entrance('pop')]).warnings).toEqual([])
    expect(run([entrance('pop')]).warnings).toEqual([
      {
        operation: 0,
        message: '--lc-entrance pop is neither a preset nor keyframes of the document',
      },
    ])
  })
})
