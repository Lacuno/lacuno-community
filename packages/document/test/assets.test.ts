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
const hash = 'b'.repeat(64)

describe('assets', () => {
  it('creates, updates and deletes an asset, warning on a duplicate hash', () => {
    const { document, warnings } = run([
      {
        type: 'asset.create',
        id: 'a-logo',
        name: 'logo.svg',
        kind: 'svg',
        hash,
        mime: 'image/svg+xml',
        size: 10,
      },
      { type: 'asset.update', id: 'a-logo', name: 'brand.svg', alt: 'Brand' },
      {
        type: 'asset.create',
        name: 'again.svg',
        kind: 'svg',
        hash,
        mime: 'image/svg+xml',
        size: 10,
      },
    ])
    expect(document.assets['a-logo']).toEqual({
      id: 'a-logo',
      name: 'brand.svg',
      kind: 'svg',
      hash,
      mime: 'image/svg+xml',
      size: 10,
      alt: 'Brand',
    })
    expect(warnings).toEqual([
      { operation: 2, message: 'an asset with the same hash already exists: a-logo' },
    ])
    const after = run([{ type: 'asset.delete', id: 'a-logo' }], document).document
    expect(after.assets['a-logo']).toBeUndefined()
  })
  it('refuses deleting a referenced asset and validates the hash', () => {
    const e = failing([{ type: 'asset.delete', id: 'a-hero' }], /referenced/)
    expect(e.referencedBy).toEqual(['nodes.n-hero-image'])
    const font = failing([{ type: 'asset.delete', id: 'a-sans' }], /referenced/)
    expect(font.referencedBy).toEqual(['site.fonts.1'])
    failing(
      [
        {
          type: 'asset.create',
          name: 'x',
          kind: 'file',
          hash: 'nope',
          mime: 'text/plain',
          size: 1,
        },
      ],
      /invalid input: hash/,
    )
    failing([{ type: 'asset.update', id: 'a-nope', name: 'x' }], /unknown asset a-nope/)
  })
})
