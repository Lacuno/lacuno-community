import { fixtureDocument } from '@miralo/schema'
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

describe('components', () => {
  it('creates a component with a root subtree, updates it, and deletes it with the subtree', () => {
    const { document, created } = run([
      {
        type: 'component.create',
        id: 'cmp-cta',
        name: 'CTA',
        props: [{ name: 'label', type: 'string', default: 'Go' }],
        root: {
          type: 'element',
          tag: 'div',
          children: [{ type: 'text', tag: 'span', text: { type: 'prop', prop: 'label' } }],
        },
      },
      { type: 'component.update', id: 'cmp-cta', name: 'Call to action', description: 'd' },
    ])
    const cmp = document.components['cmp-cta']!
    expect(cmp).toMatchObject({ name: 'Call to action', description: 'd' })
    expect(document.nodes[cmp.root]!.parent).toBeNull()
    expect(created[0]).toEqual(['cmp-cta', cmp.root, document.nodes[cmp.root]!.children[0]])
    const after = run([{ type: 'component.delete', id: 'cmp-cta' }], document).document
    expect(after.components['cmp-cta']).toBeUndefined()
    expect(after.nodes[cmp.root]).toBeUndefined()
  })
  it('refuses to delete a component with instances', () => {
    const e = failing([{ type: 'component.delete', id: 'cmp-card' }], /referenced/)
    expect(e.referencedBy).toEqual(['nodes.n-post-card'])
    failing([{ type: 'component.update', id: 'nope', name: 'x' }], /unknown component nope/)
  })
  it('extracts a subtree into a component and replaces it with an instance', () => {
    const { document, created } = run([
      {
        type: 'component.extract',
        node: 'n-hero',
        id: 'cmp-hero',
        instance: 'n-hero-instance',
        name: 'Hero',
      },
    ])
    expect(created[0]).toEqual(['cmp-hero', 'n-hero-instance'])
    expect(document.components['cmp-hero']).toEqual({
      id: 'cmp-hero',
      name: 'Hero',
      root: 'n-hero',
      props: [],
    })
    expect(document.nodes['n-hero']!.parent).toBeNull()
    expect(document.nodes['n-home']!.children).toEqual(['n-hero-instance', 'n-posts'])
    expect(document.nodes['n-hero-instance']).toEqual({
      id: 'n-hero-instance',
      type: 'component',
      component: 'cmp-hero',
      parent: 'n-home',
      children: [],
      classes: [],
    })
    expect(document.nodes['n-hero-inner']!.parent).toBe('n-hero')
  })
  it('refuses to extract a root node or an unknown node', () => {
    failing([{ type: 'component.extract', node: 'n-home', name: 'x' }], /root node/)
    failing([{ type: 'component.extract', node: 'nope', name: 'x' }], /unknown node nope/)
  })
  it('unextracts atomically with original IDs and refuses unresolved component bindings', () => {
    const before = fixtureDocument()
    const extracted = run(
      [
        {
          type: 'component.extract',
          node: 'n-hero',
          id: 'cmp-hero',
          instance: 'n-hero-instance',
          name: 'Hero',
        },
      ],
      before,
    ).document
    expect(
      run([{ type: 'component.unextract', id: 'cmp-hero', instance: 'n-hero-instance' }], extracted)
        .document,
    ).toEqual(before)
    const bound = run(
      [
        {
          type: 'component.update',
          id: 'cmp-hero',
          props: [{ name: 'title', type: 'string', default: 'Title' }],
        },
        { type: 'node.update', id: 'n-hero-title', text: { type: 'prop', prop: 'title' } },
      ],
      extracted,
    ).document
    failing(
      [{ type: 'component.unextract', id: 'cmp-hero', instance: 'n-hero-instance' }],
      /component-scoped/,
      bound,
    )
  })
})
