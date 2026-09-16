import { describe, expect, it } from 'vitest'
import { PatchError } from '../src/errors.js'
import { applyPatches, type Patch } from '../src/patch.js'

const base = () => ({
  a: { b: { c: 1 }, list: ['x', 'y', 'z'] },
  other: { untouched: true },
})

describe('applyPatches', () => {
  it('sets values, creating intermediate objects, without mutating the input', () => {
    const input = base()
    const out = applyPatches(input, [
      { op: 'set', path: ['a', 'b', 'c'], value: 2 },
      { op: 'set', path: ['a', 'new', 'deep'], value: 'v' },
    ])
    expect(out.a.b.c).toBe(2)
    expect((out.a as Record<string, unknown>).new).toEqual({ deep: 'v' })
    expect(input.a.b.c).toBe(1)
    expect(out.other).toBe(input.other)
    expect(out.a.list).toBe(input.a.list)
  })

  it('sets array elements by index', () => {
    const out = applyPatches(base(), [{ op: 'set', path: ['a', 'list', 1], value: 'Y' }])
    expect(out.a.list).toEqual(['x', 'Y', 'z'])
  })

  it('deletes keys and rejects a missing key', () => {
    const out = applyPatches(base(), [{ op: 'delete', path: ['a', 'b'] }])
    expect(out.a).toEqual({ list: ['x', 'y', 'z'] })
    expect(() => applyPatches(base(), [{ op: 'delete', path: ['a', 'nope'] }])).toThrow(PatchError)
  })

  it('inserts, removes and moves within arrays', () => {
    const out = applyPatches(base(), [
      { op: 'insert', path: ['a', 'list'], index: 1, value: 'w' },
      { op: 'remove', path: ['a', 'list'], index: 0 },
      { op: 'move', path: ['a', 'list'], from: 0, to: 2 },
    ])
    expect(out.a.list).toEqual(['y', 'z', 'w'])
    expect(
      applyPatches(base(), [{ op: 'insert', path: ['a', 'list'], index: 3, value: 'end' }]).a.list,
    ).toEqual(['x', 'y', 'z', 'end'])
  })

  it('rejects out-of-range indexes and non-array targets', () => {
    const bad: Patch[] = [
      { op: 'insert', path: ['a', 'list'], index: 4, value: 'n' },
      { op: 'remove', path: ['a', 'list'], index: 3 },
      { op: 'move', path: ['a', 'list'], from: 0, to: 3 },
      { op: 'insert', path: ['a', 'b'], index: 0, value: 'n' },
      { op: 'remove', path: ['a', 'missing'], index: 0 },
    ]
    for (const p of bad) {
      try {
        applyPatches(base(), [p])
        expect.unreachable(`expected ${p.op} to throw`)
      } catch (e) {
        expect(e).toBeInstanceOf(PatchError)
        expect((e as PatchError).patch).toBe(p)
      }
    }
  })

  it('applies patches in order so later patches see earlier ones', () => {
    const out = applyPatches({} as Record<string, unknown>, [
      { op: 'set', path: ['nodes', 'n1'], value: { id: 'n1', children: [] } },
      { op: 'insert', path: ['nodes', 'n1', 'children'], index: 0, value: 'n2' },
    ])
    expect(out).toEqual({ nodes: { n1: { id: 'n1', children: ['n2'] } } })
  })
})
