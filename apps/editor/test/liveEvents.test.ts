import { applyPatches } from '@lacuno/document/patch'
import { fixtureDocument } from '@lacuno/schema'
import { describe, expect, it } from 'vitest'
import { emptyHistory } from '../src/history.js'
import { catchUp, land, type SiteEvent, touchedNodes } from '../src/liveEvents.js'

const event = (revision: number): SiteEvent => ({
  revision,
  patches: [],
  actor: { kind: 'agent', app: 'Claude Code' },
  at: 0,
  summary: '1 change',
})
const revisions = ({ run, gap }: ReturnType<typeof catchUp>) => ({
  run: run.map((item) => item.revision),
  gap,
})

describe('catchUp', () => {
  it('applies the batch that follows the snapshot', () => {
    expect(revisions(catchUp([event(4)], 3))).toEqual({ run: [4], gap: false })
  })

  it('drains a queue in order after a save, skipping what the save already covers', () => {
    // Queued while the designer's save was in flight: their own batch 4, then an agent's 5 and 6.
    expect(revisions(catchUp([event(4), event(5), event(6)], 4))).toEqual({
      run: [5, 6],
      gap: false,
    })
  })

  it('leaves nothing to apply when the snapshot already covers every event', () => {
    expect(revisions(catchUp([event(2), event(3)], 3))).toEqual({ run: [], gap: false })
  })

  it('reports a gap when a revision is missing', () => {
    expect(revisions(catchUp([event(5)], 3))).toEqual({ run: [], gap: true })
    expect(revisions(catchUp([event(4), event(6)], 3))).toEqual({ run: [4], gap: true })
  })
})

describe('touchedNodes', () => {
  it('names each node a batch touches once, in order', () => {
    expect(
      touchedNodes([
        { op: 'set', path: ['nodes', 'n-new'], value: {} },
        { op: 'insert', path: ['nodes', 'n-body', 'children'], index: 0, value: 'n-new' },
        { op: 'set', path: ['nodes', 'n-new', 'text'], value: 'Hi' },
        { op: 'set', path: ['styles', 's-1'], value: {} },
      ]),
    ).toEqual(['n-new', 'n-body'])
  })
})

describe('land', () => {
  const title = (value: string) => ({
    op: 'set' as const,
    path: ['nodes', 'n-hero-title', 'text'],
    value: { type: 'static', value },
  })
  const before = fixtureDocument()
  const original = before.nodes['n-hero-title']

  it('puts an agent batch on the undo history so the designer can take it back', () => {
    const { document, history } = land(before, emptyHistory(), [
      { ...event(1), patches: [title('By the agent')] },
    ])
    expect(document.nodes['n-hero-title']).toMatchObject({
      text: { type: 'static', value: 'By the agent' },
    })
    expect(history.undo).toHaveLength(1)
    expect(history.redo).toEqual([])
    expect(applyPatches(document, history.undo[0]!.undo).nodes['n-hero-title']).toEqual(original)
  })

  it("keeps another editor session's batch off the history", () => {
    const { document, history } = land(before, emptyHistory(), [
      { ...event(1), actor: { kind: 'editor' }, patches: [title('By another editor')] },
    ])
    expect(document.nodes['n-hero-title']).toMatchObject({
      text: { type: 'static', value: 'By another editor' },
    })
    expect(history.undo).toEqual([])
  })
})
