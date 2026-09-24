import { color, designToken, fixtureDocument, px } from '@miralo/schema'
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

describe('design tokens', () => {
  it('creates, updates values per mode, and deletes', () => {
    const { document } = run([
      {
        type: 'designToken.create',
        id: 't-accent',
        name: 'color.accent',
        group: 'color',
        values: { light: color('#f00') },
      },
      { type: 'designToken.setValue', id: 't-accent', mode: 'dark', value: color('#f66') },
      { type: 'designToken.update', id: 't-accent', description: 'Accent' },
      { type: 'designToken.clearValue', id: 't-accent', mode: 'dark' },
    ])
    expect(document.designTokens['t-accent']).toEqual({
      id: 't-accent',
      name: 'color.accent',
      group: 'color',
      values: { light: color('#f00') },
      description: 'Accent',
    })
    const after = run([{ type: 'designToken.delete', id: 't-accent' }], document).document
    expect(after.designTokens['t-accent']).toBeUndefined()
  })
  it('validates modes, names, default values and references', () => {
    failing(
      [{ type: 'designToken.create', name: 'x', group: 'other', values: { sepia: px(1) } }],
      /unknown mode sepia/,
    )
    failing(
      [{ type: 'designToken.create', name: 'x', group: 'other', values: { dark: px(1) } }],
      /default mode light/,
    )
    failing(
      [{ type: 'designToken.create', name: 'color.fg', group: 'color', values: { light: px(1) } }],
      /name color.fg is already used by t-fg/,
    )
    failing(
      [{ type: 'designToken.create', name: 'Bad Name', group: 'other', values: { light: px(1) } }],
      /invalid input: name/,
    )
    failing(
      [
        {
          type: 'designToken.create',
          id: 't-self',
          name: 'self',
          group: 'other',
          values: { light: designToken('t-self') },
        },
      ],
      /unknown design token t-self/,
    )
    failing(
      [{ type: 'designToken.setValue', id: 't-fg', mode: 'light', value: designToken('t-fg') }],
      /cannot reference itself/,
    )
    failing(
      [{ type: 'designToken.setValue', id: 't-fg', mode: 'light', value: designToken('t-nope') }],
      /unknown design token t-nope/,
    )
    failing([{ type: 'designToken.clearValue', id: 't-fg', mode: 'light' }], /default mode/)
    failing(
      [{ type: 'designToken.clearValue', id: 't-brand', mode: 'dark' }],
      /no value for mode dark/,
    )
    failing(
      [{ type: 'designToken.update', id: 't-nope', name: 'x' }],
      /unknown design token t-nope/,
    )
  })
  it('refuses to delete a referenced token and lists the references', () => {
    const e = failing([{ type: 'designToken.delete', id: 't-brand' }], /referenced/)
    expect(e.referencedBy).toEqual([
      'styles.c-button-primary|base|none|background-color',
      'styles.c-button|base|focus-visible|outline',
    ])
    failing([{ type: 'designToken.delete', id: 't-space-lg' }], /referenced/)
  })
})
