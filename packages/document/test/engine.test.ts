import { fixtureDocument } from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineOperation, type OperationDef } from '../src/define.js'
import { planBatch } from '../src/engine.js'
import { OperationError } from '../src/errors.js'

// A tiny operation used only to exercise the engine: renames a class and reports a warning.
const rename = defineOperation(
  z.object({ type: z.literal('test.rename'), id: z.string(), name: z.string().min(1) }),
  (op, ctx) => {
    const cls = ctx.require(ctx.doc.classes[op.id], `unknown class ${op.id}`, op.id)
    if (cls.name === op.name) ctx.warn('name unchanged')
    return [{ op: 'set', path: ['classes', op.id, 'name'], value: op.name }]
  },
)
const create = defineOperation(
  z.object({ type: z.literal('test.create'), id: z.string().optional(), name: z.string() }),
  (op, ctx) => {
    const id = ctx.id('class', op.id)
    return [{ op: 'set', path: ['classes', id], value: { id, kind: 'class', name: op.name } }]
  },
)
const defs: ReadonlyMap<string, OperationDef> = new Map([
  [rename.type, rename as OperationDef],
  [create.type, create as OperationDef],
])

describe('planBatch', () => {
  it('plans operations in order against an evolving draft and reports created ids', () => {
    const doc = fixtureDocument()
    const result = planBatch(
      doc,
      [
        { type: 'test.create', id: 'c-new', name: 'fresh' },
        { type: 'test.rename', id: 'c-new', name: 'renamed' },
        { type: 'test.create', name: 'anon' },
      ],
      defs,
    )
    expect(result.document.classes['c-new']).toEqual({
      id: 'c-new',
      kind: 'class',
      name: 'renamed',
    })
    expect(result.created[0]).toEqual(['c-new'])
    expect(result.created[2]![0]).toMatch(/^[A-Za-z0-9]{12}$/)
    expect(result.patches).toHaveLength(3)
    expect(result.warnings).toEqual([])
    expect(doc.classes['c-new']).toBeUndefined()
    expect(Object.isFrozen(result.document)).toBe(true)
  })

  it('collects warnings with the operation index', () => {
    const result = planBatch(
      fixtureDocument(),
      [{ type: 'test.rename', id: 'c-hero', name: 'hero' }],
      defs,
    )
    expect(result.warnings).toEqual([{ operation: 0, message: 'name unchanged' }])
  })

  it('rejects unknown operations, invalid inputs, duplicate and malformed ids, with the index', () => {
    const doc = fixtureDocument()
    type RawOperation = { type: string } & Record<string, unknown>
    const expectError = (ops: RawOperation[], index: number, pattern: RegExp) => {
      try {
        planBatch(doc, ops, defs)
        expect.unreachable()
      } catch (e) {
        expect(e).toBeInstanceOf(OperationError)
        expect((e as OperationError).index).toBe(index)
        expect((e as OperationError).message).toMatch(pattern)
      }
    }
    expectError([{ type: 'nope' }], 0, /unknown operation nope/)
    expectError([{ type: 'test.rename', id: 'c-hero' }], 0, /name/)
    expectError(
      [
        { type: 'test.rename', id: 'c-hero', name: 'x' },
        { type: 'test.rename', id: 'missing', name: 'x' },
      ],
      1,
      /unknown class missing/,
    )
    expectError(
      [{ type: 'test.create', id: 'c-hero', name: 'dup' }],
      0,
      /id c-hero is already in use/,
    )
    expectError([{ type: 'test.create', id: 'bad id!', name: 'x' }], 0, /not a valid id/)
    expectError(
      [{ type: 'test.create', id: 'constructor', name: 'x' }],
      0,
      /reserved id|not a valid id/,
    )
    expectError(
      [
        { type: 'test.create', id: 'twice', name: 'a' },
        { type: 'test.create', id: 'twice', name: 'b' },
      ],
      1,
      /already in use/,
    )
  })
})
