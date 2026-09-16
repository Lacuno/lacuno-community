import { fixtureDocument, parseDocument } from '@freeflow/schema'
import { describe, expect, it } from 'vitest'
import { serializeDocument } from '../src/serialize.js'

describe('serializeDocument', () => {
  it('round-trips and is independent of insertion order', () => {
    const a = fixtureDocument()
    const b = fixtureDocument()
    b.nodes = Object.fromEntries(Object.entries(b.nodes).reverse())
    b.classes = Object.fromEntries(Object.entries(b.classes).reverse())
    const text = serializeDocument(a)
    expect(text).toBe(serializeDocument(b))
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.startsWith('{\n  "version": 1,\n  "revision": 0,\n  "site": {')).toBe(true)
    expect(parseDocument(JSON.parse(text))).toEqual(a)
    const nodeKeys = Object.keys((JSON.parse(text) as { nodes: Record<string, unknown> }).nodes)
    expect(nodeKeys).toEqual([...nodeKeys].sort())
  })
})
