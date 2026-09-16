import { fixtureDocument } from '@freeflow/schema'
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

describe('site.update', () => {
  it('sets and clears fields', () => {
    const { document, patches } = run([
      { type: 'site.update', name: 'New', url: 'https://x.example', headCode: null },
    ])
    expect(document.site.name).toBe('New')
    expect(document.site.url).toBe('https://x.example')
    expect(patches).toEqual([
      { op: 'set', path: ['site', 'name'], value: 'New' },
      { op: 'set', path: ['site', 'url'], value: 'https://x.example' },
    ])
  })
  it('checks favicon and font assets exist', () => {
    failing([{ type: 'site.update', favicon: 'a-nope' }], /unknown asset a-nope/)
    failing(
      [{ type: 'site.update', fonts: [{ family: 'F', source: 'asset', asset: 'a-nope' }] }],
      /unknown asset a-nope/,
    )
    expect(run([{ type: 'site.update', favicon: 'a-hero' }]).document.site.favicon).toBe('a-hero')
  })
})

describe('modes', () => {
  it('creates a mode, and switching the default clears the previous one', () => {
    const { document } = run([
      { type: 'mode.create', id: 'sepia', label: 'Sepia', selector: '[data-theme="sepia"]' },
      { type: 'mode.update', id: 'sepia', default: true },
    ])
    expect(document.site.modes.map((m) => [m.id, m.default ?? false])).toEqual([
      ['light', false],
      ['dark', false],
      ['sepia', true],
    ])
  })
  it('refuses to unset the only default, delete the default or last mode, or a mode in use', () => {
    failing(
      [{ type: 'mode.update', id: 'light', default: false }],
      /make another mode the default first/,
    )
    failing([{ type: 'mode.delete', id: 'light' }], /default mode/)
    const e = failing([{ type: 'mode.delete', id: 'dark' }], /referenced/)
    expect(e.referencedBy).toEqual(['t-bg', 't-border', 't-brand-hover', 't-fg', 't-surface-muted'])
    failing([{ type: 'mode.update', id: 'nope', label: 'x' }], /unknown mode nope/)
  })
  it('deletes an unused mode', () => {
    const { document } = run([
      { type: 'mode.create', id: 'sepia', label: 'Sepia' },
      { type: 'mode.delete', id: 'sepia' },
    ])
    expect(document.site.modes.map((m) => m.id)).toEqual(['light', 'dark'])
  })
})

describe('redirects', () => {
  it('adds and removes redirects and refuses duplicates', () => {
    const { document } = run([
      { type: 'redirect.add', from: '/a', to: '/b' },
      { type: 'redirect.remove', from: '/old-blog' },
    ])
    expect(document.redirects).toEqual([{ from: '/a', to: '/b', status: 301 }])
    failing([{ type: 'redirect.add', from: '/old-blog', to: '/x' }], /already exists/)
    failing([{ type: 'redirect.remove', from: '/nope' }], /no redirect from \/nope/)
  })
})
