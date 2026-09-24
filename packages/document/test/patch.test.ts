import { fixtureDocument } from '@miralo/schema'
import { describe, expect, it } from 'vitest'
import { PatchError } from '../src/errors.js'
import type { Operation } from '../src/operations/index.js'
import { applyPatches, invertPatches, type Patch } from '../src/patch.js'
import { DocumentStore } from '../src/store.js'

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

describe('invertPatches', () => {
  /** Commits a batch, undoes it with the inverted patches, then redoes it, checking both ends. */
  async function roundTrip(store: DocumentStore, operations: Operation[]) {
    const before = store.read().document
    const { patches } = await store.apply({ expectedRevision: store.revision, operations })
    const after = store.read().document
    const undone = applyPatches(after, invertPatches(before, patches))
    expect({ ...undone, revision: before.revision }).toEqual(before)
    await store.apply({ expectedRevision: store.revision, patches: invertPatches(before, patches) })
    expect({ ...store.read().document, revision: before.revision }).toEqual(before)
    await store.apply({ expectedRevision: store.revision, patches })
    expect({ ...store.read().document, revision: after.revision }).toEqual(after)
    return after
  }

  it('reverses creating, moving and deleting nodes', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    await roundTrip(store, [
      {
        type: 'node.create',
        parent: 'n-hero-inner',
        index: 0,
        node: {
          id: 'n-new',
          type: 'element',
          tag: 'div',
          children: [{ type: 'text', tag: 'p', text: { type: 'static', value: 'Hi' } }],
        },
      },
      { type: 'node.move', id: 'n-new', parent: 'n-hero-inner', index: 1 },
    ])
    await roundTrip(store, [{ type: 'node.delete', id: 'n-new' }])
    await roundTrip(store, [{ type: 'node.move', id: 'n-hero-title', parent: 'n-home', index: 0 }])
  })

  it('restores a style declaration, its absence and its important flag', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    const color = { class: 'c-page', breakpoint: 'base', state: 'none' as const, property: 'color' }
    await roundTrip(store, [
      { type: 'style.set', ...color, value: { type: 'color', value: '#ffffff' }, important: true },
      {
        type: 'style.set',
        ...color,
        property: 'outline-offset',
        value: { type: 'unit', value: 2, unit: 'px' },
      },
      { type: 'style.clear', ...color, property: 'font-family' },
    ])
  })

  it('restores a deleted combo class with its lock and its styles', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    await store.apply({
      expectedRevision: store.revision,
      operations: [
        { type: 'class.create', id: 'c-combo', name: 'card-wide', combo: ['c-page'], locked: true },
        {
          type: 'style.set',
          class: 'c-combo',
          breakpoint: 'base',
          state: 'none',
          property: 'color',
          value: { type: 'color', value: '#123456' },
        },
      ],
    })
    const after = await roundTrip(store, [{ type: 'class.delete', id: 'c-combo' }])
    expect(after.classes['c-combo']).toBeUndefined()
  })

  it('reverses creating and deleting a page with its subtree', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    await roundTrip(store, [
      {
        type: 'page.create',
        id: 'p-about',
        name: 'About',
        path: '/about',
        root: {
          id: 'n-about',
          type: 'element',
          tag: 'main',
          children: [{ type: 'text', tag: 'h1', text: { type: 'static', value: 'About' } }],
        },
      },
    ])
    await roundTrip(store, [{ type: 'page.delete', id: 'p-home' }])
  })

  it('reverses extracting a component and unextracting it again', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    await roundTrip(store, [
      {
        type: 'component.extract',
        node: 'n-hero-cta',
        id: 'cmp-cta',
        instance: 'n-cta',
        name: 'Call to action',
      },
    ])
    await roundTrip(store, [{ type: 'component.unextract', id: 'cmp-cta', instance: 'n-cta' }])
  })

  it('reverses a mixed batch as one step', async () => {
    const store = DocumentStore.inMemory(fixtureDocument())
    await roundTrip(store, [
      { type: 'node.update', id: 'n-hero-title', text: { type: 'static', value: 'New heading' } },
      { type: 'class.create', id: 'c-local', local: true },
      { type: 'node.update', id: 'n-hero-title', classes: ['c-heading', 'c-local'] },
      {
        type: 'style.set',
        class: 'c-local',
        breakpoint: 'base',
        state: 'none',
        property: 'color',
        value: { type: 'color', value: '#000000' },
      },
      {
        type: 'designToken.setValue',
        id: 't-fg',
        mode: 'dark',
        value: { type: 'color', value: '#eeeeee' },
      },
      {
        type: 'node.create',
        parent: 'n-home',
        node: { id: 'n-tail', type: 'element', tag: 'footer' },
      },
      { type: 'node.delete', id: 'n-hero-image' },
    ])
  })
})
